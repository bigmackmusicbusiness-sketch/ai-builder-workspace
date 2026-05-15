// apps/api/src/agent/phases/complete.ts — Phase B-complete: deterministic
// post-loop completion pass.
//
// PROBLEM IT SOLVES
// =================
// The legacy chat.ts iter loop relies on prompt steering ("STOP. WRITE THE
// FILES.") to convince the model to finish every planned page. That works
// most of the time; it doesn't always. When it fails the model keeps
// emitting prose-only turns until MAX_ITERATIONS = 30 is exhausted, and
// the loop exits with planned pages still missing from disk. The site
// renders with broken nav links to pages that were never written.
//
// FIX
// ===
// This phase runs once AFTER the iter loop, regardless of how the loop
// exited. For each planned page that is still missing on disk, it:
//
//   1. Issues ONE focused single-shot model call with toolChoice='required',
//      a hyper-narrow system message naming exactly the one page to write,
//      and the previous build context as history.
//   2. Executes any write_file calls the model emits.
//   3. Re-checks the disk. If the file is still missing, writes a
//      deterministic templated stub built from plan.sitemap[].sections
//      and (where possible) the nav/footer extracted from index.html.
//
// This guarantees every planned page exists on disk before runPostPhase
// (humanizer + polish) runs. The model call gives us best-effort quality;
// the template fallback guarantees the site is navigable. No infinite
// retry — at most one model call per missing page, then template.

import type { ProviderAdapter, ChatMessage, ToolCall, ToolDefinition } from '@abw/providers';
import type { WorkspaceHandle } from '../../preview/workspace';
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from '../../preview/workspace';
import { executeToolCall, type ToolContext } from '../tools';
import type { PlanType } from './plan';

export interface CompletionPhaseInput {
  ws:           WorkspaceHandle;
  plan:         PlanType;
  /** The full chat history at the end of the iter loop. Used as context for
   *  the focused single-shot calls so the model has access to the same plan
   *  + already-written files it had during the main loop. */
  history:      ChatMessage[];
  adapter:      ProviderAdapter;
  model:        string;
  signal:       AbortSignal;
  toolList:     ToolDefinition[];
  toolCtx:      ToolContext;
  projectSlug:  string;
  /** SSE emitter for delta / tool_start / tool_result events. Same shape the
   *  iter loop uses so the SPA's existing handlers render the events without
   *  any new event types. */
  send:         (event: unknown) => void;
}

export interface CompletionPhaseResult {
  /** Pages that were already on disk when the phase started. */
  alreadyExisted: number;
  /** Pages the model successfully wrote during the focused single-shot call. */
  modelWrote:     number;
  /** Pages written via the deterministic template fallback. */
  templated:      number;
  /** Pages we couldn't write at all (write failed for both model and template). */
  failed:         string[];
}

/** Run the completion phase. Returns immediately if every planned page is
 *  already on disk. Never throws — caller wraps in try/catch but failures
 *  are silent and self-contained. */
export async function runCompletionPhase(input: CompletionPhaseInput): Promise<CompletionPhaseResult> {
  const { ws, plan, history, adapter, model, signal, toolList, toolCtx, projectSlug, send } = input;
  const result: CompletionPhaseResult = {
    alreadyExisted: 0,
    modelWrote:     0,
    templated:      0,
    failed:         [],
  };

  // Walk plan.sitemap; identify which pages don't exist on disk yet.
  // listWorkspaceFiles returns paths with a leading slash (e.g. "/index.html"),
  // so strip it here to match the no-leading-slash candidates in pageOnDisk.
  // Mirrors the normalization convention in chat.ts:540-605 buildIncomplete
  // logic. Without this, every page is treated as missing and the template
  // fallback overwrites the model's real work.
  const onDisk = new Set(
    (await listWorkspaceFiles(ws))
      .map((p) => p.replace(/^\/+/, '').toLowerCase()),
  );
  const missing: { slug: string; targetPath: string; pagePlan: PlanType['sitemap'][number] }[] = [];
  for (const pagePlan of plan.sitemap) {
    const targetPath = pagePlan.slug === 'index' ? 'index.html' : `${pagePlan.slug}.html`;
    const exists = pageOnDisk(pagePlan.slug, onDisk);
    if (exists) {
      result.alreadyExisted += 1;
      continue;
    }
    missing.push({ slug: pagePlan.slug, targetPath, pagePlan });
  }

  if (missing.length === 0) {
    return result;
  }

  // Surface a one-line status so the UI shows "filling gaps".
  send({
    type:  'delta',
    delta: `\n\n_Finishing build — writing ${missing.length} missing page${missing.length === 1 ? '' : 's'}: ${missing.map((m) => m.targetPath).join(', ')}._\n`,
  });

  // Try to pull the nav + footer out of index.html (if it exists) so the
  // template fallback can re-use them — keeps cross-page navigation working.
  const indexHtml = await readWorkspaceFile(ws, 'index.html').catch(() => null);
  const { nav, footer } = indexHtml
    ? extractNavAndFooter(indexHtml)
    : { nav: '', footer: '' };

  for (const { slug, targetPath, pagePlan } of missing) {
    if (signal.aborted) break;

    // Step 1: focused single-shot model call (toolChoice='required') asking
    // the model to write JUST this one page. Bounded — at most one call per
    // missing page, no nudging, no loop.
    let wrote = false;
    try {
      wrote = await tryFocusedWrite({
        slug, targetPath, pagePlan, plan, history, adapter, model,
        signal, toolList, toolCtx, projectSlug, send,
      });
    } catch {
      // Non-fatal — fall through to template.
    }

    // Step 2: re-check disk. If the focused call succeeded, count it and move on.
    // Same leading-slash normalization as the initial scan above — paths from
    // listWorkspaceFiles come with a leading slash that pageOnDisk's candidates
    // don't have.
    if (wrote) {
      const after = new Set(
        (await listWorkspaceFiles(ws))
          .map((p) => p.replace(/^\/+/, '').toLowerCase()),
      );
      if (pageOnDisk(slug, after)) {
        result.modelWrote += 1;
        continue;
      }
    }

    // Step 3: template fallback. Deterministic write of a minimum-viable
    // page that reuses index.html's nav + footer (if extractable). This
    // ensures the site is navigable even when the model fully refused.
    try {
      const stub = buildTemplatedStub({ pagePlan, plan, projectSlug, nav, footer });
      await writeWorkspaceFile(ws, targetPath, stub);
      result.templated += 1;
      // Emit a synthetic tool_result so the UI shows progress.
      send({
        type:    'tool_result',
        id:      `complete:template:${slug}`,
        ok:      true,
        summary: `Templated ${targetPath} (build completion fallback)`,
      });
    } catch (err) {
      result.failed.push(slug);
      // eslint-disable-next-line no-console
      console.warn(`[complete] failed to template ${slug}.html: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 4 — broken internal-link backstop (round 16 gap 2).
  //
  // SPS surfaced this on the Joe & the Juice E2E: pages ship with footers
  // linking to terms.html / privacy.html, but those pages were never in
  // plan.sitemap and never written. Every customer site shipped with two
  // dead footer links until manually patched. The fix is more general
  // than just legal pages: scan every written HTML for internal `*.html`
  // links, diff against what's actually on disk, template a stub for any
  // dangling target. Catches future "linked but not written" cases beyond
  // ToS/Privacy.
  //
  // Bounded: only scans .html files inside the workspace root (no
  // subdirectory recursion needed — the agent writes flat), only matches
  // bare `href="X.html"` links (not absolute URLs, not anchor jumps).
  // Each templated stub reuses the same nav + footer extracted above and
  // a niche-appropriate placeholder body via buildLinkBackstopStub.
  try {
    await backstopBrokenLinks({
      ws,
      plan,
      projectSlug,
      nav,
      footer,
      result,
      send,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[complete] broken-link backstop failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

// ── Broken-link backstop ─────────────────────────────────────────────────────

interface BackstopInput {
  ws:           WorkspaceHandle;
  plan:         PlanType;
  projectSlug:  string;
  nav:          string;
  footer:       string;
  result:       CompletionPhaseResult;
  send:         (event: unknown) => void;
}

/** Scan written .html files for internal `href="X.html"` links that don't
 *  resolve to a file on disk, then template a stub for each. Idempotent
 *  and bounded: only the immediate workspace root is scanned, only
 *  bare-filename links are considered, and we cap at 8 backstop pages per
 *  build so a runaway agent can't pin disk via this path. */
async function backstopBrokenLinks(input: BackstopInput): Promise<void> {
  const { ws, plan, projectSlug, nav, footer, result, send } = input;
  const MAX_BACKSTOP = 8;

  // Collect every workspace file (with leading-slash normalization, same
  // as the sitemap scan above). Build a set of basenames for quick lookup.
  const onDiskRaw = await listWorkspaceFiles(ws);
  const onDisk = new Set(onDiskRaw.map((p) => p.replace(/^\/+/, '').toLowerCase()));

  // Pull internal href targets from every .html on disk.
  const linkTargets = new Set<string>();
  for (const rawPath of onDiskRaw) {
    const path = rawPath.replace(/^\/+/, '');
    if (!/\.html?$/i.test(path)) continue;
    const content = await readWorkspaceFile(ws, path).catch(() => null);
    if (!content) continue;
    // Match href="X.html" / href='X.html' — bare filename only.
    // Skip http(s) URLs, protocol-relative URLs, anchor-only #foo,
    // mailto/tel links, and paths starting with /api or /images.
    const matches = content.matchAll(/href\s*=\s*["']([^"'#?]+\.html?)(?:[#?][^"']*)?["']/gi);
    for (const m of matches) {
      const raw = m[1];
      if (!raw) continue;
      const href = raw.trim();
      // Reject absolute or protocol-relative — only flat filenames + relative paths.
      if (/^(https?:)?\/\//i.test(href)) continue;
      if (href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      // Normalize "./foo.html" to "foo.html". Drop a leading slash if any.
      let normalized = href.replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
      // Ignore subdirectory paths — only top-level page stubs are backstopped.
      if (normalized.includes('/')) continue;
      linkTargets.add(normalized);
    }
  }

  // Diff against what's on disk + against the sitemap (sitemap entries are
  // already handled by the main loop above; if they failed there, they'll
  // be skipped here too).
  const sitemapTargets = new Set(plan.sitemap.map((p) => `${p.slug === 'index' ? 'index' : p.slug}.html`));
  const missing: string[] = [];
  for (const target of linkTargets) {
    if (onDisk.has(target)) continue;
    if (sitemapTargets.has(target)) continue;  // sitemap loop handled it
    if (missing.length >= MAX_BACKSTOP) break;
    missing.push(target);
  }

  if (missing.length === 0) return;

  send({
    type:  'delta',
    delta: `\n\n_Backfilling ${missing.length} link target${missing.length === 1 ? '' : 's'} the agent referenced but didn't write: ${missing.join(', ')}._\n`,
  });

  for (const targetPath of missing) {
    const slug = targetPath.replace(/\.html?$/i, '');
    try {
      const stub = buildLinkBackstopStub({ slug, plan, projectSlug, nav, footer });
      await writeWorkspaceFile(ws, targetPath, stub);
      result.templated += 1;
      send({
        type:    'tool_result',
        id:      `complete:linkstub:${slug}`,
        ok:      true,
        summary: `Backfilled ${targetPath} (referenced in footer/nav but never written)`,
      });
    } catch (err) {
      result.failed.push(slug);
      // eslint-disable-next-line no-console
      console.warn(`[complete] failed to backfill ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Build a placeholder page for a link target that wasn't in plan.sitemap.
 *  Handles common legal-page slugs (terms, privacy, etc.) with real-looking
 *  boilerplate; falls back to a generic "Page being written" stub for
 *  anything else. Reuses nav + footer so the page stays integrated with
 *  the rest of the site. */
function buildLinkBackstopStub(input: {
  slug: string;
  plan: PlanType;
  projectSlug: string;
  nav: string;
  footer: string;
}): string {
  const { slug, plan, projectSlug, nav, footer } = input;
  const currentYear = new Date().getFullYear();
  const today       = new Date().toISOString().slice(0, 10);
  const niceSlug    = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const fallbackNav    = nav || defaultNav(plan, projectSlug);
  const fallbackFooter = footer || defaultFooter(plan, currentYear);

  // Pre-canned legal copy for the two most common cases. Real-looking
  // boilerplate, not Lorem ipsum, but clearly marked as placeholder so
  // the operator knows to swap it before publish.
  const slugLower = slug.toLowerCase();
  let title:    string;
  let eyebrow:  string;
  let bodyHtml: string;
  if (slugLower === 'terms' || slugLower === 'terms-of-service' || slugLower === 'tos') {
    title    = 'Terms of Service';
    eyebrow  = 'Legal';
    bodyHtml = legalSectionsHtml([
      ['Acceptance of Terms', `By accessing this site you agree to be bound by these Terms of Service. If you do not agree, please do not use the site.`],
      ['Use of the Service', `You agree to use the site for lawful purposes only and in a way that doesn't infringe on the rights of others or restrict their use of the site.`],
      ['Intellectual Property', `All content, design, and trademarks on this site are the property of ${escapeHtml(projectSlug.replace(/-/g, ' '))} or its licensors and are protected by copyright laws.`],
      ['Limitation of Liability', `This site and its content are provided "as is" without warranty of any kind. We are not liable for any damages arising from your use of the site.`],
      ['Changes to These Terms', `We may update these terms from time to time. Continued use of the site after changes constitutes acceptance of the revised terms.`],
      ['Contact', `Questions about these terms? Reach us at hello@yourbusiness.com.`],
    ]);
  } else if (slugLower === 'privacy' || slugLower === 'privacy-policy') {
    title    = 'Privacy Policy';
    eyebrow  = 'Legal';
    bodyHtml = legalSectionsHtml([
      ['Information We Collect', `We collect information you provide directly (such as when you contact us or sign up for updates) and basic analytics data about how you use the site.`],
      ['How We Use Information', `We use the information we collect to respond to inquiries, improve the site, and send updates you've requested. We do not sell personal information.`],
      ['Sharing of Information', `We share information only with service providers who help us operate the site, and only as needed to provide those services.`],
      ['Cookies and Analytics', `The site uses cookies for basic functionality and aggregate analytics. You can disable cookies in your browser settings.`],
      ['Your Rights', `You can request a copy of your data, ask us to correct it, or request deletion. Contact us at hello@yourbusiness.com.`],
      ['Updates', `We may update this policy. Material changes will be posted on this page with a revised "Last Updated" date.`],
    ]);
  } else {
    // Generic backstop — clearly-marked stub. The operator will see it
    // and know to swap before publish.
    title    = niceSlug;
    eyebrow  = 'Page coming soon';
    bodyHtml = `
    <section class="bg-white py-16">
      <div class="max-w-3xl mx-auto px-6">
        <p class="text-slate-600 leading-relaxed">
          This page is referenced from the site's navigation but the
          content hasn't been written yet. Update this stub with the
          real ${escapeHtml(niceSlug)} content before publishing.
        </p>
      </div>
    </section>`;
  }

  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `  <meta charset="UTF-8" />`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
    `  <title>${escapeHtml(title)} | ${escapeHtml(projectSlug.replace(/-/g, ' '))}</title>`,
    `  <meta name="description" content="${escapeHtml(title)} page for ${escapeHtml(projectSlug.replace(/-/g, ' '))}." />`,
    `  <script src="https://cdn.tailwindcss.com"></script>`,
    `</head>`,
    `<body class="bg-white text-slate-900 antialiased">`,
    fallbackNav,
    `  <main>`,
    `    <header class="bg-slate-100 py-20">`,
    `      <div class="max-w-4xl mx-auto px-6 text-center">`,
    `        <p class="uppercase tracking-widest text-sm text-slate-500 mb-2">${escapeHtml(eyebrow)}</p>`,
    `        <h1 class="text-4xl md:text-5xl font-bold">${escapeHtml(title)}</h1>`,
    `        <p class="text-sm text-slate-500 mt-3">Last Updated: ${today}</p>`,
    `      </div>`,
    `    </header>`,
    bodyHtml,
    `  </main>`,
    fallbackFooter,
    `</body>`,
    `</html>`,
    ``,
  ].join('\n');
}

function legalSectionsHtml(sections: Array<[string, string]>): string {
  return sections.map(([heading, body], i) => {
    const oddBg = i % 2 === 0 ? 'bg-white' : 'bg-slate-50';
    return [
      `    <section class="${oddBg} py-12">`,
      `      <div class="max-w-3xl mx-auto px-6">`,
      `        <h2 class="text-2xl font-semibold mb-3">${escapeHtml(heading)}</h2>`,
      `        <p class="text-slate-600 leading-relaxed">${escapeHtml(body)}</p>`,
      `      </div>`,
      `    </section>`,
    ].join('\n');
  }).join('\n');
}

// ── Disk-existence check ─────────────────────────────────────────────────────

/** Check whether any of the canonical paths for a sitemap slug exist on disk.
 *  Mirrors the chat.ts iter-loop logic so both checks stay in sync. */
function pageOnDisk(slug: string, onDisk: Set<string>): boolean {
  const candidates = [
    `${slug}.html`,
    `${slug}.htm`,
    `${slug}/index.html`,
    `pages/${slug}.html`,
  ].map((c) => c.toLowerCase());
  return candidates.some((c) => onDisk.has(c));
}

// ── Focused single-shot model call ───────────────────────────────────────────

interface FocusedWriteInput {
  slug:        string;
  targetPath:  string;
  pagePlan:    PlanType['sitemap'][number];
  plan:        PlanType;
  history:     ChatMessage[];
  adapter:     ProviderAdapter;
  model:       string;
  signal:      AbortSignal;
  toolList:    ToolDefinition[];
  toolCtx:     ToolContext;
  projectSlug: string;
  send:        (event: unknown) => void;
}

/** Issue one focused model call asking for ONE page to be written via
 *  write_file. Returns true if a write_file tool call succeeded. */
async function tryFocusedWrite(input: FocusedWriteInput): Promise<boolean> {
  const { slug, targetPath, pagePlan, plan, history, adapter, model, signal, toolList, toolCtx, projectSlug, send } = input;

  // Build the focused system message. Hyper-narrow scope: one page, one
  // tool call, no narration, no list_files, no read_file. The model already
  // saw the full plan + built other pages — this is just closing the gap.
  const sectionsList = pagePlan.sections.map((s) => `- ${s}`).join('\n');
  const focusedSystem = [
    `## SINGLE-PAGE COMPLETION TASK`,
    ``,
    `The previous build turn ended without writing **${targetPath}**.`,
    `Write it now in **one** call. No narration, no other tools.`,
    ``,
    `### Page details (from the validated plan)`,
    `- **File:** \`${targetPath}\``,
    `- **Title:** ${pagePlan.title}`,
    `- **Role:** ${pagePlan.role}`,
    `- **Sections (in order):**`,
    sectionsList,
    `- **SEO title:** ${pagePlan.seo.title}`,
    `- **Meta description:** ${pagePlan.seo.meta_description}`,
    pagePlan.schema_org && pagePlan.schema_org.length > 0
      ? `- **Schema.org JSON-LD types:** ${pagePlan.schema_org.join(', ')}`
      : '',
    ``,
    `### Style requirements`,
    `- Tailwind via CDN: \`<script src="https://cdn.tailwindcss.com"></script>\``,
    `- Voice: ${plan.voice}`,
    `- Palette: \`${plan.palette}\` (match the colors used in the pages you already wrote)`,
    `- Match the nav + footer markup of the other pages you wrote in this build.`,
    `- Project slug: "${projectSlug}".`,
    ``,
    `### Output rules`,
    `- Call \`write_file\` ONCE with \`path="${targetPath}"\` and the complete HTML as \`content\`.`,
    `- Do **not** call \`list_files\` or \`read_file\` first — you already have the context.`,
    `- Do **not** narrate. Do **not** ask questions. Just the one \`write_file\` call.`,
  ].filter(Boolean).join('\n');

  const focusedReq = {
    messages: [...history, { role: 'system' as const, content: focusedSystem }],
    model,
    temperature: 0.3,                              // lower temp = more compliant
    maxTokens:   4096,
    tools:       toolList,
    toolChoice:  'required' as const,              // FORCE a tool call
  };

  const toolCalls: ToolCall[] = [];
  try {
    for await (const chunk of adapter.chat(focusedReq, { signal })) {
      if (signal.aborted) return false;
      if (chunk.type === 'delta') {
        send(chunk);
      } else if (chunk.type === 'tool_call') {
        toolCalls.push(chunk.toolCall);
      } else if (chunk.type === 'done') {
        break;
      } else if (chunk.type === 'error') {
        // Surface but don't throw — let template fallback handle it.
        send(chunk);
        return false;
      }
    }
  } catch {
    return false;
  }

  if (toolCalls.length === 0) {
    return false;
  }

  // Execute only write_file calls for our target path. Ignore everything else
  // (e.g. if the model emitted list_files despite the directive).
  let wrote = false;
  for (const tc of toolCalls) {
    if (tc.function.name !== 'write_file') continue;
    try {
      send({ type: 'tool_start', id: tc.id, name: tc.function.name, args: tc.function.arguments });
      const res = await executeToolCall(toolCtx, tc.function.name, tc.function.arguments);
      send({ type: 'tool_result', id: tc.id, ok: res.ok, summary: res.summary });
      if (res.ok) wrote = true;
    } catch {
      // Non-fatal — caller will fall back to template.
    }
    if (wrote) break;                              // one good write is enough
  }

  // Workspace handle's listWorkspaceFiles is more authoritative than the
  // tool result summary — return false here if the file is still missing,
  // caller will template.
  return wrote;
}

// ── Template fallback (deterministic, no model) ──────────────────────────────

interface TemplatedStubInput {
  pagePlan:    PlanType['sitemap'][number];
  plan:        PlanType;
  projectSlug: string;
  nav:         string;
  footer:      string;
}

/** Build a minimal but functional HTML page. Re-uses nav/footer extracted
 *  from index.html so the site stays navigable. Each plan-defined section
 *  becomes a placeholder block the user can refine — not Lorem ipsum, but
 *  named placeholders that telegraph "this page exists but needs a polish
 *  pass", which is strictly better than a 404. */
function buildTemplatedStub(input: TemplatedStubInput): string {
  const { pagePlan, plan, projectSlug, nav, footer } = input;
  const escapedTitle    = escapeHtml(pagePlan.title);
  const escapedSeoTitle = escapeHtml(pagePlan.seo.title);
  const escapedMeta     = escapeHtml(pagePlan.seo.meta_description);
  const escapedRole     = escapeHtml(pagePlan.role);
  const currentYear     = new Date().getFullYear();

  const sectionsHtml = pagePlan.sections.map((sec, i) => {
    const escapedSec = escapeHtml(sec);
    const oddBg = i % 2 === 0 ? 'bg-white' : 'bg-slate-50';
    return [
      `    <section class="${oddBg} py-16">`,
      `      <div class="max-w-4xl mx-auto px-6">`,
      `        <h2 class="text-3xl font-semibold mb-4">${escapedSec}</h2>`,
      `        <p class="text-slate-600 leading-relaxed">`,
      `          This section covers ${escapedSec.toLowerCase()} for ${escapeHtml(pagePlan.title)}.`,
      `          Refine the copy here to match the rest of the site's voice.`,
      `        </p>`,
      `      </div>`,
      `    </section>`,
    ].join('\n');
  }).join('\n');

  const fallbackNav    = nav || defaultNav(plan, projectSlug);
  const fallbackFooter = footer || defaultFooter(plan, currentYear);

  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `  <meta charset="UTF-8" />`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
    `  <title>${escapedSeoTitle}</title>`,
    `  <meta name="description" content="${escapedMeta}" />`,
    `  <script src="https://cdn.tailwindcss.com"></script>`,
    `</head>`,
    `<body class="bg-white text-slate-900 antialiased">`,
    fallbackNav,
    `  <main>`,
    `    <header class="bg-slate-100 py-20">`,
    `      <div class="max-w-4xl mx-auto px-6 text-center">`,
    `        <p class="uppercase tracking-widest text-sm text-slate-500 mb-2">${escapedRole}</p>`,
    `        <h1 class="text-4xl md:text-5xl font-bold">${escapedTitle}</h1>`,
    `      </div>`,
    `    </header>`,
    sectionsHtml,
    `  </main>`,
    fallbackFooter,
    `</body>`,
    `</html>`,
    ``,
  ].join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the `<nav>...</nav>` and `<footer>...</footer>` blocks from
 *  index.html so the template fallback can re-use them. Best-effort —
 *  returns empty strings if no match, in which case buildTemplatedStub
 *  uses defaultNav / defaultFooter. */
function extractNavAndFooter(html: string): { nav: string; footer: string } {
  const navMatch    = /<nav\b[^>]*>[\s\S]*?<\/nav>/i.exec(html);
  const footerMatch = /<footer\b[^>]*>[\s\S]*?<\/footer>/i.exec(html);
  return {
    nav:    navMatch    ? navMatch[0]    : '',
    footer: footerMatch ? footerMatch[0] : '',
  };
}

function defaultNav(plan: PlanType, projectSlug: string): string {
  const links = plan.sitemap.map((p) => {
    const href = p.slug === 'index' ? 'index.html' : `${p.slug}.html`;
    return `        <a href="${href}" class="text-slate-700 hover:text-slate-900">${escapeHtml(p.title)}</a>`;
  }).join('\n');
  return [
    `  <nav class="border-b border-slate-200 bg-white">`,
    `    <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">`,
    `      <a href="index.html" class="font-semibold text-lg">${escapeHtml(projectSlug.replace(/-/g, ' '))}</a>`,
    `      <div class="hidden md:flex gap-8 text-sm">`,
    links,
    `      </div>`,
    `    </div>`,
    `  </nav>`,
  ].join('\n');
}

function defaultFooter(plan: PlanType, currentYear: number): string {
  return [
    `  <footer class="border-t border-slate-200 bg-slate-50 py-10 mt-16">`,
    `    <div class="max-w-6xl mx-auto px-6 text-sm text-slate-600">`,
    `      <p>&copy; ${currentYear}. All rights reserved.</p>`,
    `      <p class="mt-1 text-xs text-slate-400">Niche: ${escapeHtml(plan.niche)}</p>`,
    `    </div>`,
    `  </footer>`,
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
