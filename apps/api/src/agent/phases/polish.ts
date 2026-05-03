// apps/api/src/agent/phases/polish.ts — Phase C: Polish auto-fixes + audit.
//
// Two modes:
//   1. Subagent (full): MiniMax call with polish.md SOP, accesses read_file +
//      write_file + list_files. Iteration budget 5.
//   2. Inline (fast): regex-based auto-fix pass over written HTML files.
//      Cheaper, runs as a post-process. Returns findings list for chat surface.
//
// Step 2 ships mode 2 — inline pass. Mode 1 lands when we expand the polish
// to need MiniMax-driven rewrites (e.g., color contrast remedies, footer
// keyword-stuffing rewrites).

import type { WorkspaceHandle } from '../../preview/workspace';
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from '../../preview/workspace';
import { scanForCredentials, scanForRiskyHtml } from '../security';

export interface AuditFinding {
  level:    'auto-fixed' | 'flag';
  category: 'seo' | 'a11y' | 'perf' | 'security' | 'consistency';
  page?:    string;
  message:  string;
  fix?:     string;
}

export interface PolishResult {
  ok:        boolean;
  findings:  AuditFinding[];
  filesTouched: number;
  error?:    string;
}

/** Run inline polish auto-fixes over all HTML files in a workspace. */
export async function runInlinePolish(ws: WorkspaceHandle): Promise<PolishResult> {
  const findings: AuditFinding[] = [];
  let filesTouched = 0;
  const currentYear = new Date().getFullYear();

  try {
    const files = await listWorkspaceFiles(ws);
    const htmlFiles = files.filter((p) => /\.html?$/i.test(p));

    for (const path of htmlFiles) {
      const original = await readWorkspaceFile(ws, path);
      if (!original) continue;
      let updated = original;

      // ── Security audit (BEFORE auto-fix passes) ────────────────────────────
      const credFindings = scanForCredentials(updated);
      for (const c of credFindings) {
        if (c.severity === 'block') {
          findings.push({
            level:    'flag',
            category: 'security',
            page:     path,
            message:  `Hardcoded ${c.provider} credential found (${c.preview}). Strip it and use an env variable instead.`,
          });
        } else {
          // strip-class: replace inline
          const before = updated;
          updated = updated.replace(new RegExp(c.pattern, 'g'), `[REDACTED-${c.provider.toUpperCase().replace(/\s+/g, '_')}]`);
          if (before !== updated) {
            findings.push({
              level:    'auto-fixed',
              category: 'security',
              page:     path,
              message:  `Stripped ${c.provider} credential (${c.preview})`,
              fix:      'Replaced with REDACTED marker',
            });
          }
        }
      }

      const riskyFindings = scanForRiskyHtml(updated);
      for (const r of riskyFindings) {
        findings.push({
          level:    r.category === 'unsafe-target-blank' ? 'auto-fixed' : 'flag',
          category: 'security',
          page:     path,
          message:  r.message,
        });
      }

      // ── Auto-fix: rel="noopener noreferrer" on target="_blank" ─────────────
      const blankBefore = updated;
      updated = updated.replace(
        /<a([^>]*?)\btarget=["']_blank["']([^>]*?)>/gi,
        (match, before, after) => {
          if (/rel=["'][^"']*noopener/i.test(match)) return match;
          // Insert rel attribute. If a rel exists without noopener, append.
          if (/\brel=["']([^"']*)["']/i.test(match)) {
            return match.replace(/\brel=["']([^"']*)["']/i, (_m: string, val: string) => `rel="${val} noopener noreferrer"`);
          }
          return `<a${before} target="_blank" rel="noopener noreferrer"${after}>`;
        },
      );
      if (blankBefore !== updated) {
        findings.push({ level: 'auto-fixed', category: 'security', page: path, message: 'Added rel="noopener noreferrer" to target="_blank" links' });
      }

      // ── Auto-fix: <html lang="..."> ───────────────────────────────────────
      if (/<html(?![^>]*\blang=)/i.test(updated)) {
        updated = updated.replace(/<html\b/i, '<html lang="en"');
        findings.push({ level: 'auto-fixed', category: 'a11y', page: path, message: 'Added lang="en" to <html>' });
      }

      // ── Auto-fix: copyright year ───────────────────────────────────────────
      // Replace ©? \d{4} or ©? YEAR placeholders with the current year
      const yearBefore = updated;
      updated = updated.replace(/©\s*(?:\d{4}|YEAR|\{year\})/gi, `© ${currentYear}`);
      updated = updated.replace(/copyright\s+(?:©\s*)?(?:\d{4}|YEAR|\{year\})/gi, `Copyright © ${currentYear}`);
      if (yearBefore !== updated) {
        findings.push({ level: 'auto-fixed', category: 'consistency', page: path, message: `Set copyright year to ${currentYear}` });
      }

      // ── Audit: <title> presence + length ────────────────────────────────
      const titleMatch = updated.match(/<title>([^<]*)<\/title>/i);
      if (!titleMatch) {
        findings.push({ level: 'flag', category: 'seo', page: path, message: 'No <title> tag found' });
      } else if ((titleMatch[1] ?? '').length > 60) {
        findings.push({ level: 'flag', category: 'seo', page: path, message: `<title> is ${titleMatch[1]?.length ?? 0} chars (>60 recommended)` });
      }

      // ── Audit: meta description ────────────────────────────────────────────
      const descMatch = updated.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
      if (!descMatch) {
        findings.push({ level: 'flag', category: 'seo', page: path, message: 'No <meta name="description"> found' });
      } else if ((descMatch[1] ?? '').length > 160) {
        findings.push({ level: 'flag', category: 'seo', page: path, message: `Meta description is ${descMatch[1]?.length ?? 0} chars (>160 recommended)` });
      }

      // ── Audit: h1 ──────────────────────────────────────────────────────────
      const h1Matches = updated.match(/<h1\b/gi);
      if (!h1Matches) {
        findings.push({ level: 'flag', category: 'seo', page: path, message: 'No <h1> heading found' });
      } else if (h1Matches.length > 1) {
        findings.push({ level: 'flag', category: 'seo', page: path, message: `Found ${h1Matches.length} <h1> tags (should be 1)` });
      }

      // ── Audit: img alt text ────────────────────────────────────────────────
      const imgsWithoutAlt = updated.match(/<img\b(?![^>]*\balt=)[^>]*>/gi);
      if (imgsWithoutAlt) {
        // Auto-fix: derive alt from filename
        const altBefore = updated;
        updated = updated.replace(/<img\b(?![^>]*\balt=)([^>]*)src=["']([^"']+)["']([^>]*?)>/gi,
          (_match, before, src, after) => {
            const filename = (src.split('/').pop() ?? '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
            return `<img${before}src="${src}"${after} alt="${filename}">`;
          });
        if (altBefore !== updated) {
          findings.push({ level: 'auto-fixed', category: 'a11y', page: path, message: `Added alt text to ${imgsWithoutAlt.length} <img> tags (derived from filename)` });
        }
      }

      // ── Audit: image lazy loading below-the-fold ───────────────────────────
      // Cheap heuristic: any <img> that appears AFTER the first 1500 chars and lacks loading attr → add loading="lazy"
      // This isn't perfect but catches the common case.
      if (updated.length > 1500) {
        const lazyBefore = updated;
        const headPortion = updated.slice(0, 1500);
        const tailPortion = updated.slice(1500);
        const tailFixed = tailPortion.replace(
          /<img\b(?![^>]*\bloading=)([^>]*?)>/gi,
          (_match, attrs) => `<img${attrs} loading="lazy">`,
        );
        updated = headPortion + tailFixed;
        if (lazyBefore !== updated) {
          findings.push({ level: 'auto-fixed', category: 'perf', page: path, message: 'Added loading="lazy" to below-the-fold images' });
        }
      }

      // ── Write back if changed ──────────────────────────────────────────────
      if (updated !== original) {
        await writeWorkspaceFile(ws, path, updated);
        filesTouched++;
      }
    }

    return { ok: true, findings, filesTouched };
  } catch (err) {
    return {
      ok:           false,
      findings,
      filesTouched: 0,
      error:        err instanceof Error ? err.message : String(err),
    };
  }
}
