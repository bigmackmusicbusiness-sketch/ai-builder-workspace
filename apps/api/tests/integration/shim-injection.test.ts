// apps/api/tests/integration/shim-injection.test.ts
//
// Phase 3 v2 integration test for maybeInjectSiteDataShim. Counterpart to
// standalone-regression.test.ts (which proves the gate function STAYS quiet
// for standalone projects) — this one proves it actually rewrites HTML when
// all gates pass.
//
// Env stubs MUST be set BEFORE any app-source import — siteDataShim.ts
// transitively pulls in apps/api/src/preview/workspace.ts which loads
// apps/api/src/config/env.ts at module top, and that throws if the
// crown-jewel keys aren't present. The standalone-bundle test sidesteps
// this because it only imports bundler.ts (no workspace/env transit).
//
// vitest hoists all `import` statements above top-level code, so a plain
// process.env assignment up top runs AFTER imports — too late. We use
// `vi.hoisted` so the stubs are set during the hoist pass, before any
// module body (including the chain triggered by our app imports) runs.
import { vi } from 'vitest';
vi.hoisted(() => {
  // Test-only stub values; nothing here talks to Supabase from inside this
  // test, so the actual values never matter beyond satisfying schema.
  process.env.SUPABASE_URL              ??= 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY         ??= 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
  process.env.SUPABASE_JWT_SECRET       ??= 'test-jwt-secret';
  process.env.VAULT_MASTER_KEY          ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // base64 of 32 zero bytes
});
//
// What it checks:
//   1. Pure helpers: buildShimScript output is a valid <script> block,
//      shaped right, with the bindings JSON inlined and the marker present.
//   2. Pure helper: injectShimIntoHtml inserts before LAST </body>, is
//      idempotent (returns null on second call), handles missing </body>.
//   3. Gate: a no-spsWorkspaceId project skips injection (covered for
//      standalone-regression coherence — not standalone but the same gate
//      fires for any project lacking the tag).
//   4. Gate: a spsWorkspaceId-tagged project with NO config skips injection.
//   5. Gate: a binding-eligible niche WITH config writes the marker into
//      every .html file in the workspace.
//   6. Idempotency at the workspace level — running twice on the same
//      workspace touches 0 files the second time.
//
// Run with: pnpm --filter @abw/api test:integration

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildShimScript,
  injectShimIntoHtml,
  maybeInjectSiteDataShim,
  type ProjectSignalPointHandle,
} from '../../src/agent/phases/siteDataShim';
// Type-only imports — erased at runtime, no module evaluation triggered.
import type { WorkspaceHandle } from '../../src/preview/workspace';
import type { PlanType } from '../../src/agent/phases/plan';

// Minimal config that passes the gate-2 check (presence > shape — the gate
// only checks falsy/truthy on the whole object, not on individual fields).
const FAKE_CONFIG: NonNullable<ProjectSignalPointHandle['signalpointConfig']> = {
  workspace_id:  '00000000-0000-0000-0000-000000000099',
  supabase_url:  'https://kpbaozjekixqxfeeikyw.supabase.co',
  anon_key:      'eyJ-test-anon-key-not-real',
  edge_token:    'edge-token-test',
  edge_base_url: 'https://embed.signalpointportal.com',
  expires_at:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

// A plan slug that maps to a binding-eligible niche manifest. 'restaurant' is
// in the BINDING_ELIGIBLE set per add-phase3-bindings.mjs.
const RESTAURANT_PLAN: PlanType = {
  niche:           'restaurant',
  voice:           'warm and direct',
  palette:         'sage and oat',
  sitemap:         [{ slug: 'index', kind: 'home', filename: 'index.html', title: 'Home', purpose: 'home' }],
  shared_assets:   [],
  asset_budget:    { hero: 1, primary: 1, supporting: 0 },
  compliance_blocks: [],
} as unknown as PlanType;

describe('siteDataShim — pure helpers', () => {
  it('buildShimScript inlines the bindings JSON and contains the marker', () => {
    const out = buildShimScript([
      { source: 'menu_sections', target: 'sections' },
      { source: 'menu_items',    target: 'menu' },
    ]);
    expect(out).toContain('<!-- abw:signalpoint-shim:v1 -->');
    expect(out).toContain('"source":"menu_sections"');
    expect(out).toContain('"target":"sections"');
    expect(out).toContain('"source":"menu_items"');
    expect(out).toContain('"target":"menu"');
    expect(out).toContain('signalpoint-config.json');
    expect(out).toContain('window.__signalpoint');
  });

  it('buildShimScript escapes embedded </script> in binding strings', () => {
    // Defensive — we control the input, but if a manifest ever has a
    // </script> in a target string, it should be neutered.
    const out = buildShimScript([
      { source: 'menu_items', target: '</script><img src=x>' },
    ]);
    expect(out).not.toContain('</script><img');
    expect(out).toContain('<\\/script');
  });

  it('injectShimIntoHtml places the script before the LAST </body>', () => {
    const html = '<html><body><p>hello</p></body></html>';
    const script = '<!-- abw:signalpoint-shim:v1 -->\n<script>x()</script>';
    const out = injectShimIntoHtml(html, script);
    expect(out).not.toBeNull();
    // The marker must come before </body>:
    const markerIdx = out!.indexOf('<!-- abw:signalpoint-shim:v1 -->');
    const bodyClose = out!.indexOf('</body>');
    expect(markerIdx).toBeGreaterThan(0);
    expect(bodyClose).toBeGreaterThan(markerIdx);
  });

  it('injectShimIntoHtml returns null on second pass (idempotent)', () => {
    const html = '<html><body><p>hello</p></body></html>';
    const script = '<!-- abw:signalpoint-shim:v1 -->\n<script>x()</script>';
    const once = injectShimIntoHtml(html, script);
    expect(once).not.toBeNull();
    const twice = injectShimIntoHtml(once!, script);
    expect(twice).toBeNull();
  });

  it('injectShimIntoHtml appends at end when no </body> tag is present', () => {
    const html = '<div>fragment with no body tag</div>';
    const script = '<!-- abw:signalpoint-shim:v1 -->\n<script>x()</script>';
    const out = injectShimIntoHtml(html, script);
    expect(out).not.toBeNull();
    expect(out!.endsWith('<script>x()</script>\n')).toBe(true);
  });
});

describe('siteDataShim — workspace integration', () => {
  let tempDir: string;
  let ws: WorkspaceHandle;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'abw-shim-injection-'));
    // Build a tiny but realistic workspace: 2 HTML files + 1 CSS + 1 JSON.
    await mkdir(join(tempDir, 'css'), { recursive: true });
    await writeFile(join(tempDir, 'index.html'),  '<html><head><title>Cafe</title></head><body><h1>Hello</h1></body></html>',  'utf8');
    await writeFile(join(tempDir, 'menu.html'),   '<html><body><h1>Menu</h1><p>tbd</p></body></html>', 'utf8');
    await writeFile(join(tempDir, 'css/site.css'),'body{font-family:serif}', 'utf8');
    await writeFile(join(tempDir, 'data.json'),   '{"hello":"world"}', 'utf8');
    ws = {
      tenantId:    'test-tenant',
      projectSlug: 'shim-fixture',
      rootDir:     tempDir,
    } as unknown as WorkspaceHandle;
  });

  afterAll(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('skips when project has no spsWorkspaceId (standalone)', async () => {
    const res = await maybeInjectSiteDataShim({
      ws,
      projectTypeId: 'website',
      plan:          RESTAURANT_PLAN,
      project:       { spsWorkspaceId: null, signalpointConfig: null },
    });
    expect(res.injected).toBe(false);
    expect(res.reason).toMatch(/standalone/);
    expect(res.filesTouched).toBe(0);
  });

  it('skips when spsWorkspaceId is set but signalpointConfig is null', async () => {
    const res = await maybeInjectSiteDataShim({
      ws,
      projectTypeId: 'website',
      plan:          RESTAURANT_PLAN,
      project:       { spsWorkspaceId: '00000000-0000-0000-0000-000000000099', signalpointConfig: null },
    });
    expect(res.injected).toBe(false);
    expect(res.reason).toMatch(/issuer not yet wired/);
    expect(res.filesTouched).toBe(0);
  });

  it('injects into every .html file when all gates pass', async () => {
    const res = await maybeInjectSiteDataShim({
      ws,
      projectTypeId: 'website',
      plan:          RESTAURANT_PLAN,
      project:       { spsWorkspaceId: '00000000-0000-0000-0000-000000000099', signalpointConfig: FAKE_CONFIG },
    });
    expect(res.injected).toBe(true);
    expect(res.filesTouched).toBe(2);
    expect(res.bindings.length).toBeGreaterThan(0);

    const indexHtml = await readFile(join(tempDir, 'index.html'), 'utf8');
    const menuHtml  = await readFile(join(tempDir, 'menu.html'),  'utf8');
    expect(indexHtml).toContain('<!-- abw:signalpoint-shim:v1 -->');
    expect(menuHtml).toContain('<!-- abw:signalpoint-shim:v1 -->');
    // Marker must come BEFORE </body>:
    expect(indexHtml.indexOf('<!-- abw:signalpoint-shim:v1 -->')).toBeLessThan(indexHtml.indexOf('</body>'));
    expect(menuHtml.indexOf('<!-- abw:signalpoint-shim:v1 -->')).toBeLessThan(menuHtml.indexOf('</body>'));

    // Non-HTML files should not be modified.
    const css = await readFile(join(tempDir, 'css/site.css'), 'utf8');
    expect(css).not.toContain('signalpoint-shim');
  });

  it('second injection pass is a no-op (idempotent)', async () => {
    // First call already happened above; running again should touch 0 files.
    const res = await maybeInjectSiteDataShim({
      ws,
      projectTypeId: 'website',
      plan:          RESTAURANT_PLAN,
      project:       { spsWorkspaceId: '00000000-0000-0000-0000-000000000099', signalpointConfig: FAKE_CONFIG },
    });
    expect(res.injected).toBe(true);
    expect(res.filesTouched).toBe(0); // marker already present → all skipped

    // Verify the marker appears exactly once per HTML file.
    const indexHtml = await readFile(join(tempDir, 'index.html'), 'utf8');
    const occurrences = (indexHtml.match(/abw:signalpoint-shim:v1/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('reports would-inject when ws is omitted (gate-only mode)', async () => {
    const res = await maybeInjectSiteDataShim({
      // ws intentionally omitted
      projectTypeId: 'website',
      plan:          RESTAURANT_PLAN,
      project:       { spsWorkspaceId: '00000000-0000-0000-0000-000000000099', signalpointConfig: FAKE_CONFIG },
    });
    expect(res.injected).toBe(true);
    expect(res.filesTouched).toBe(0);
    expect(res.reason).toMatch(/no ws provided/);
    expect(res.bindings.length).toBeGreaterThan(0);
  });

  it('skips when matched niche has no site_data_bindings', async () => {
    // 'tree-service' is not in BINDING_ELIGIBLE — schema fields are absent.
    const standaloneNichePlan = { ...RESTAURANT_PLAN, niche: 'tree-service' };
    const res = await maybeInjectSiteDataShim({
      ws,
      projectTypeId: 'website',
      plan:          standaloneNichePlan,
      project:       { spsWorkspaceId: '00000000-0000-0000-0000-000000000099', signalpointConfig: FAKE_CONFIG },
    });
    expect(res.injected).toBe(false);
    expect(res.reason).toMatch(/no site_data_bindings/);
    expect(res.filesTouched).toBe(0);
  });
});
