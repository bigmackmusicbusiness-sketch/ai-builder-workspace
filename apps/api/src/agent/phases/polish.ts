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

// Patterns matching common niche-specific compliance disclaimers. The check
// below flags a page when sibling pages contain one of these phrases but the
// page itself doesn't — catches iterative rewrites that strip required text.
const COMPLIANCE_PATTERNS: RegExp[] = [
  /Federal Fair Housing Act[^<]{0,200}/i,
  /Equal Housing Opportunity/i,
  /All real estate advertised/i,
  /FDA[- ]approved/i,
  /not (?:medical|financial|legal|investment) advice/i,
  /SEC[- ]registered/i,
  /Attorney Advertising/i,
  /Member SIPC/i,
  /FINRA[- ]registered/i,
];

/** Niche → required disclaimer phrases. When the workspace's `_plan.json`
 *  identifies a regulated niche, the polish phase flags pages that don't
 *  carry at least one phrase from each required category. The patterns are
 *  permissive (match any wording variant) so the flag fires only when the
 *  disclaimer is genuinely absent, not when phrasing is novel. */
interface NicheRequirement {
  /** A niche identifier substring (case-insensitive) — matched against plan.niche */
  match:     RegExp;
  /** Human-readable label of the regulatory regime. */
  regime:    string;
  /** Each entry: a label + at least one regex that satisfies the rule. */
  required:  Array<{ label: string; anyOf: RegExp[] }>;
}
const NICHE_COMPLIANCE_RULES: NicheRequirement[] = [
  {
    match:    /real-?estate|realtor|broker/i,
    regime:   'Fair Housing (HUD)',
    required: [
      { label: 'Equal Housing / Fair Housing Act notice', anyOf: [
        /Federal Fair Housing Act/i, /Equal Housing Opportunity/i,
      ]},
    ],
  },
  {
    match:    /medical|clinic|doctor|telehealth|telemedicine|physician|dentist|dental|chiropractor|therapist|psych|nurs/i,
    regime:   'Medical (HIPAA + FDA)',
    required: [
      { label: 'Not-medical-advice disclaimer', anyOf: [
        /not (?:intended as )?medical advice/i, /educational purposes only/i,
        /consult (?:your|a) (?:physician|doctor|provider)/i,
      ]},
    ],
  },
  {
    match:    /finance|fintech|investment|trading|crypto|wealth|advisor|bank/i,
    regime:   'Financial (SEC / FINRA)',
    required: [
      { label: 'Not-investment-advice disclaimer', anyOf: [
        /not (?:investment|financial) advice/i, /educational (?:purposes|material) only/i,
        /consult (?:a|your) (?:financial )?(?:advisor|professional)/i,
      ]},
      { label: 'Past-performance / risk disclosure', anyOf: [
        /past performance/i, /risk of loss/i, /investments? (?:carry|involve) risk/i,
      ]},
    ],
  },
  {
    match:    /law|legal|attorney|lawyer|paralegal|barrister/i,
    regime:   'Legal (Bar / Attorney Advertising)',
    required: [
      { label: 'Attorney advertising disclaimer', anyOf: [
        /attorney advertising/i, /this (?:is|may be) (?:considered )?advertising/i,
      ]},
      { label: 'No legal-advice / no attorney-client relationship', anyOf: [
        /not (?:intended as )?legal advice/i,
        /no attorney[- ]client relationship/i,
        /does not (?:create|form|establish) (?:an )?attorney[- ]client relationship/i,
      ]},
    ],
  },
  {
    match:    /pharmacy|supplement|cbd|cannabis/i,
    regime:   'FDA / DSHEA',
    required: [
      { label: 'FDA-not-evaluated disclaimer (supplement-style)', anyOf: [
        /These statements have not been evaluated by the (?:Food and Drug Administration|FDA)/i,
        /not intended to (?:diagnose|treat|cure|prevent)/i,
      ]},
    ],
  },
];

/** Run inline polish auto-fixes over all HTML files in a workspace. */
export async function runInlinePolish(ws: WorkspaceHandle): Promise<PolishResult> {
  const findings: AuditFinding[] = [];
  let filesTouched = 0;
  const currentYear = new Date().getFullYear();

  try {
    const files = await listWorkspaceFiles(ws);
    const htmlFiles = files.filter((p) => /\.html?$/i.test(p));

    // ── Read the build plan to learn the niche ─────────────────────────────
    // _plan.json lives at workspace root and is written by the planner phase.
    // Missing on iteration prompts where the planner didn't fire — that's OK,
    // we just skip niche-specific compliance audits in that case.
    let planNiche = '';
    try {
      const planRaw = await readWorkspaceFile(ws, '_plan.json');
      if (planRaw) {
        const parsed = JSON.parse(planRaw) as { niche?: string };
        planNiche = parsed.niche ?? '';
      }
    } catch { /* missing or malformed plan — skip niche check */ }

    // ── A6: Niche-specific compliance audit ────────────────────────────────
    // Concatenate the bodies of all HTML files; if a regulated niche matches,
    // verify each required disclaimer appears at least once across the
    // workspace. Per-page coverage is enforced separately by the regression
    // check below (compliancePagesByPhrase).
    if (planNiche) {
      const matchingRule = NICHE_COMPLIANCE_RULES.find((r) => r.match.test(planNiche));
      if (matchingRule) {
        // Collect all html bodies once
        const allBodies: string[] = [];
        for (const p of htmlFiles) {
          const c = await readWorkspaceFile(ws, p);
          if (c) allBodies.push(c);
        }
        const corpus = allBodies.join('\n');
        for (const req of matchingRule.required) {
          const present = req.anyOf.some((pat) => pat.test(corpus));
          if (!present) {
            findings.push({
              level:    'flag',
              category: 'security',
              message:  `${matchingRule.regime}: missing required "${req.label}" — required for niche \`${planNiche}\`. Add it to the footer of at least one page (typically every page).`,
            });
          }
        }
      }
    }

    // Pre-scan for compliance phrases that appear on AT LEAST ONE page in the
    // workspace. Build a phrase→pages map so the per-page audit can spot
    // pages that "fell behind" on niche disclaimers (typical regression
    // when the agent rewrites a single page and omits the footer block).
    const compliancePagesByPhrase = new Map<string, Set<string>>();
    for (const p of htmlFiles) {
      const c = await readWorkspaceFile(ws, p);
      if (!c) continue;
      for (const pat of COMPLIANCE_PATTERNS) {
        const m = c.match(pat);
        if (m && m[0]) {
          const key = m[0].slice(0, 80);
          if (!compliancePagesByPhrase.has(key)) compliancePagesByPhrase.set(key, new Set());
          compliancePagesByPhrase.get(key)!.add(p);
        }
      }
    }

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

      // ── Audit: compliance disclaimer regression ────────────────────────────
      // If a compliance phrase appears on the majority of pages but is missing
      // here, flag it. Catches the common pattern of agent rewriting one page
      // (e.g., adding a hero video) and stripping the footer's required text.
      for (const [phrase, pagesWithIt] of compliancePagesByPhrase) {
        if (pagesWithIt.has(path)) continue;
        // Threshold: the phrase needs to appear on >=2 other pages to count
        // as "established" — a single occurrence might be intentional and
        // page-specific (e.g., a contact-page-only legal note).
        if (pagesWithIt.size >= 2) {
          findings.push({
            level:    'flag',
            category: 'consistency',
            page:     path,
            message:  `Compliance disclaimer "${phrase}…" appears on ${pagesWithIt.size} sibling page(s) but is missing here — likely stripped during a rewrite.`,
          });
        }
      }

      // ── A7: Auto-inject baseline security meta tags ────────────────────────
      // CSP, referrer-policy, and a proper viewport meta. We insert AFTER the
      // <meta charset> if present, otherwise immediately after <head>. The
      // CSP allows Tailwind CDN and Google Fonts because most generated sites
      // use them; tightening to nonce-based CSP is a future hardening step.
      if (/<head\b[^>]*>/i.test(updated)) {
        const insertSafeMeta = (doc: string, metaTag: string, marker: RegExp): string => {
          if (marker.test(doc)) return doc; // already present
          // Insert after charset if present, otherwise after <head>
          if (/<meta\s+charset=["']?[^"'>]+["']?[^>]*>/i.test(doc)) {
            return doc.replace(/(<meta\s+charset=["']?[^"'>]+["']?[^>]*>)/i, `$1\n  ${metaTag}`);
          }
          return doc.replace(/(<head\b[^>]*>)/i, `$1\n  ${metaTag}`);
        };

        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src * data: blob:; media-src * blob:; connect-src *; frame-src https://js.stripe.com https://www.youtube.com https://player.vimeo.com; frame-ancestors 'self';">`;
        const referrerMeta = `<meta name="referrer" content="strict-origin-when-cross-origin">`;
        const viewportMeta = `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`;

        const cspBefore = updated;
        updated = insertSafeMeta(
          updated,
          cspMeta,
          /<meta\s+http-equiv=["']Content-Security-Policy["']/i,
        );
        if (cspBefore !== updated) {
          findings.push({ level: 'auto-fixed', category: 'security', page: path, message: 'Added baseline Content-Security-Policy meta tag' });
        }

        const referrerBefore = updated;
        updated = insertSafeMeta(
          updated,
          referrerMeta,
          /<meta\s+name=["']referrer["']/i,
        );
        if (referrerBefore !== updated) {
          findings.push({ level: 'auto-fixed', category: 'security', page: path, message: 'Added Referrer-Policy meta tag' });
        }

        const viewportBefore = updated;
        updated = insertSafeMeta(
          updated,
          viewportMeta,
          /<meta\s+name=["']viewport["']/i,
        );
        if (viewportBefore !== updated) {
          findings.push({ level: 'auto-fixed', category: 'a11y', page: path, message: 'Added viewport meta tag' });
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
