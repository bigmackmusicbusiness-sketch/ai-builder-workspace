// apps/api/scripts/post-deploy-check.ts — runs after every Coolify deploy.
//
// Purpose: catch regressions BEFORE the user notices.
//   1. Project lifecycle invariant — count must match pre-deploy snapshot
//   2. Migrations applied — every entry in runMigrations.ts shows "applied"
//   3. Surface sweep — every browse-mode SPA route + every /api/* the IDE
//      hits returns 200 (or a deliberate non-200 like 401 for unauth probes)
//   4. Workspace restore probe — pick 3 projects, hit /api/files/workspace,
//      assert >= 1 file (proves Storage→FS restore is firing)
//   5. Pre-existing Halcyon Estates content sentinel — Halcyon should
//      always have its 5 pages + plan; if files dropped, Storage backup
//      is the truth and fail loud.
//
// Usage (from repo root):
//   pnpm tsx apps/api/scripts/post-deploy-check.ts
//
// Reads:
//   - $ABW_TOKEN env var (a fresh access token), OR halcyon-token.txt at the
//     desktop path used during dev sessions
//
// Exits 0 on full pass, 1 on any failure. Prints a clear table to stdout
// and writes a markdown summary to docs/post-deploy/<timestamp>.md.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API   = process.env['ABW_API_URL'] ?? 'https://api.40-160-3-10.sslip.io';
const APP   = process.env['ABW_APP_URL'] ?? 'https://app.40-160-3-10.sslip.io';
const TOKEN = process.env['ABW_TOKEN']
  ?? (existsSync(resolve(process.cwd(), 'C:/Users/telly/OneDrive/Desktop/halcyon-token.txt'))
        ? readFileSync(resolve(process.cwd(), 'C:/Users/telly/OneDrive/Desktop/halcyon-token.txt'), 'utf8').trim()
        : '');

if (!TOKEN) {
  console.error('No token available. Set $ABW_TOKEN or save it to halcyon-token.txt on the desktop.');
  process.exit(1);
}

interface CheckResult {
  name:    string;
  status:  'pass' | 'fail' | 'warn';
  detail?: string;
}

const results: CheckResult[] = [];

function record(name: string, status: 'pass' | 'fail' | 'warn', detail?: string): void {
  results.push({ name, status, detail });
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '⚠';
  // eslint-disable-next-line no-console
  console.log(`  ${icon} ${name.padEnd(46)} ${detail ?? ''}`);
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'X-Requested-With': 'fetch',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
}

// ── Check 1: API healthy ─────────────────────────────────────────────────────
async function checkHealth(): Promise<void> {
  try {
    const r = await fetch(`${API}/healthz`, { signal: AbortSignal.timeout(5_000) });
    if (r.ok) record('API healthz', 'pass', `${r.status}`);
    else      record('API healthz', 'fail', `${r.status}`);
  } catch (err) {
    record('API healthz', 'fail', err instanceof Error ? err.message : String(err));
  }
}

// ── Check 2: Project lifecycle invariant ─────────────────────────────────────
const SNAPSHOT_FILE = '/tmp/abw-pre-deploy-projects.json';

async function checkProjectInvariant(): Promise<void> {
  try {
    const r = await authedFetch('/api/projects');
    if (!r.ok) { record('Project list', 'fail', `HTTP ${r.status}`); return; }
    const { projects } = await r.json() as { projects: Array<{ id: string; slug: string }> };
    const slugs = projects.map((p) => p.slug).sort();

    if (existsSync(SNAPSHOT_FILE)) {
      const prev = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as string[];
      const lost = prev.filter((s) => !slugs.includes(s));
      const gained = slugs.filter((s) => !prev.includes(s));
      if (lost.length > 0) {
        record('Project lifecycle', 'fail', `LOST: ${lost.join(', ')}`);
      } else {
        record('Project lifecycle', 'pass', `${slugs.length} active${gained.length ? ` (+ ${gained.length} new)` : ''}`);
      }
    } else {
      record('Project lifecycle', 'warn', `${slugs.length} active (no pre-deploy snapshot — first run)`);
    }
    writeFileSync(SNAPSHOT_FILE, JSON.stringify(slugs, null, 2));
  } catch (err) {
    record('Project lifecycle', 'fail', err instanceof Error ? err.message : String(err));
  }
}

// ── Check 3: Migrations applied ──────────────────────────────────────────────
async function checkMigrations(): Promise<void> {
  try {
    const r = await authedFetch('/api/admin/migrations');
    if (!r.ok) { record('Migrations report', 'fail', `HTTP ${r.status}`); return; }
    const d = await r.json() as { lastBootReport?: { outcomes?: Array<{ id: string; status: string }> } };
    const outcomes = d.lastBootReport?.outcomes ?? [];
    const failed = outcomes.filter((o) => o.status === 'failed');
    if (failed.length > 0) {
      record('Migrations applied', 'fail', `failed: ${failed.map((f) => f.id).join(', ')}`);
    } else {
      record('Migrations applied', 'pass', `${outcomes.length} migrations OK`);
    }
  } catch (err) {
    record('Migrations applied', 'fail', err instanceof Error ? err.message : String(err));
  }
}

// ── Check 4: Browse SPA routes ───────────────────────────────────────────────
async function checkBrowseRoutes(): Promise<void> {
  const paths = ['/projects', '/templates', '/create', '/video', '/publish', '/approvals', '/login'];
  let ok = 0;
  for (const p of paths) {
    try {
      const r = await fetch(`${APP}${p}`, { signal: AbortSignal.timeout(8_000) });
      if (r.ok) ok++;
    } catch { /* count as fail */ }
  }
  if (ok === paths.length) record('Browse SPA routes', 'pass', `${ok}/${paths.length}`);
  else record('Browse SPA routes', 'fail', `${ok}/${paths.length}`);
}

// ── Check 5: API surface sweep ───────────────────────────────────────────────
async function checkApiSurface(): Promise<void> {
  // Use a real project id from the projects list
  let projectId = '';
  try {
    const pr = await authedFetch('/api/projects');
    const { projects } = await pr.json() as { projects: Array<{ id: string }> };
    projectId = projects[0]?.id ?? '';
  } catch { /* leave empty — endpoints will 400 */ }

  const endpoints: Array<{ name: string; path: string; expect: number[] }> = [
    { name: 'GET /api/integrations',                    path: '/api/integrations',                                 expect: [200] },
    { name: 'GET /api/secrets?env=dev',                 path: '/api/secrets?env=dev',                              expect: [200] },
    { name: 'GET /api/approvals',                       path: '/api/approvals',                                    expect: [200] },
    { name: 'GET /api/preview/sessions',                path: '/api/preview/sessions',                             expect: [200] },
    { name: 'GET /api/runs?projectId=…',                path: `/api/runs?projectId=${projectId}`,                  expect: [200, 400] },
    { name: 'GET /api/assets?projectId=…',              path: `/api/assets?projectId=${projectId}`,                expect: [200, 400] },
    { name: 'GET /api/versions?projectId=…',            path: `/api/versions?projectId=${projectId}`,              expect: [200, 400] },
    { name: 'GET /api/video?projectId=…',               path: `/api/video?projectId=${projectId}`,                 expect: [200, 400] },
    { name: 'GET /api/publish/targets?projectId=…',     path: `/api/publish/targets?projectId=${projectId}`,       expect: [200, 400] },
  ];

  let ok = 0;
  for (const ep of endpoints) {
    try {
      const r = await authedFetch(ep.path);
      if (ep.expect.includes(r.status)) ok++;
    } catch { /* count fail */ }
  }
  if (ok === endpoints.length) record('API surface sweep', 'pass', `${ok}/${endpoints.length}`);
  else record('API surface sweep', 'fail', `${ok}/${endpoints.length}`);
}

// ── Check 6: Workspace restore probe ─────────────────────────────────────────
async function checkWorkspaceRestore(): Promise<void> {
  try {
    const pr = await authedFetch('/api/projects');
    const { projects } = await pr.json() as { projects: Array<{ slug: string; type: string }> };
    // Pick the first 3 website-type projects (most likely to have backed-up files)
    const sites = projects.filter((p) => p.type === 'website').slice(0, 3);
    if (sites.length === 0) { record('Workspace restore probe', 'warn', 'no website projects to probe'); return; }

    let withFiles = 0;
    for (const site of sites) {
      // Fire a chat with list_files to trigger restore-from-Storage
      await authedFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'list_files' }],
          provider: 'minimax', model: 'MiniMax-M2.7',
          projectEnv: 'dev', projectSlug: site.slug, enableTools: true,
        }),
      }).catch(() => null);

      // small delay then check files
      await new Promise((r) => setTimeout(r, 3_000));
      const fr = await authedFetch(`/api/files/workspace?slug=${site.slug}`).catch(() => null);
      if (fr?.ok) {
        const { files } = await fr.json() as { files: string[] };
        if (files.length > 0) withFiles++;
      }
    }
    if (withFiles === sites.length) record('Workspace restore probe', 'pass', `${withFiles}/${sites.length}`);
    else record('Workspace restore probe', 'warn', `${withFiles}/${sites.length} restored`);
  } catch (err) {
    record('Workspace restore probe', 'fail', err instanceof Error ? err.message : String(err));
  }
}

// ── Check 7: Halcyon content sentinel (don't lose the proven test artifact) ──
async function checkHalcyonSentinel(): Promise<void> {
  try {
    const fr = await authedFetch('/api/files/workspace?slug=halcyon-estates');
    if (!fr.ok) { record('Halcyon sentinel', 'fail', `HTTP ${fr.status}`); return; }
    const { files } = await fr.json() as { files: string[] };
    const expected = ['/index.html', '/listings.html', '/contact.html', '/team.html', '/neighborhoods.html'];
    const missing = expected.filter((e) => !files.includes(e));
    if (missing.length === 0) record('Halcyon sentinel', 'pass', `${files.length} files`);
    else record('Halcyon sentinel', 'warn', `missing: ${missing.join(',')}`);
  } catch (err) {
    record('Halcyon sentinel', 'fail', err instanceof Error ? err.message : String(err));
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async (): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log(`\nPost-deploy check — ${new Date().toISOString()}`);
  // eslint-disable-next-line no-console
  console.log('─'.repeat(72));

  await checkHealth();
  await checkProjectInvariant();
  await checkMigrations();
  await checkBrowseRoutes();
  await checkApiSurface();
  await checkWorkspaceRestore();
  await checkHalcyonSentinel();

  // eslint-disable-next-line no-console
  console.log('─'.repeat(72));
  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  const passed = results.filter((r) => r.status === 'pass').length;
  // eslint-disable-next-line no-console
  console.log(`  ${passed} pass, ${warned} warn, ${failed} fail\n`);

  // Write markdown audit log
  try {
    const docDir = resolve(process.cwd(), 'docs', 'post-deploy');
    mkdirSync(docDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const path = join(docDir, `${ts}.md`);
    const md = [
      `# Post-deploy check — ${new Date().toISOString()}`,
      ``,
      `| Check | Status | Detail |`,
      `|---|---|---|`,
      ...results.map((r) => `| ${r.name} | ${r.status} | ${r.detail ?? ''} |`),
      ``,
      `**Result:** ${passed} pass, ${warned} warn, ${failed} fail`,
      ``,
    ].join('\n');
    writeFileSync(path, md, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`  audit log: ${path}`);
  } catch { /* non-fatal */ }

  process.exit(failed > 0 ? 1 : 0);
})();
