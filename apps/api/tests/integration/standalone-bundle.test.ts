// apps/api/tests/integration/standalone-bundle.test.ts
//
// Heavier-weight standalone-IDE guarantee test. The static-analysis
// suite at standalone-regression.test.ts asserts no source file leaks
// SPS references into the standalone path. THIS test asserts the SAME
// thing about the actual built BUNDLE — what would ship to a customer's
// printer, page, or URL.
//
// What it does:
//   1. Creates a temp project directory with a representative no-config
//      HTML fixture (the kind of output the agent produces for a niche
//      that doesn't bind to live data).
//   2. Calls bundleProject() with framework='static' — same code path
//      production publishes hit.
//   3. Asserts every asset in the output bundle:
//        - contains zero `signalpoint` strings (case-insensitive)
//        - contains zero `@supabase` imports
//        - contains zero `sps_workspace_id` / `spsWorkspaceId` references
//
// If this test fails after a Phase 3 commit, the standalone-IDE
// guarantee is broken: SPS info is leaking into the bundle that
// non-SPS users would see.
//
// Run with: pnpm --filter @abw/api test:integration

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleProject } from '../../src/preview/bundler';

let tempDir: string;
const SLUG = 'test-standalone-fixture';

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'abw-standalone-bundle-'));

  // Fixture: a minimal static site shaped like what the agent produces
  // for a typical website project. Includes the patterns we'd expect to
  // see in real output (Tailwind CDN, semantic HTML, schema.org JSON-LD)
  // so the test exercises a realistic shape.
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Maple Street Cafe — Specialty Coffee in Burlington</title>
  <meta name="description" content="Third-wave specialty coffee shop with single-origin pour-overs and house-baked sourdough.">
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CafeOrCoffeeShop",
    "name": "Maple Street Cafe",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "1402 Pearl St",
      "addressLocality": "Burlington",
      "addressRegion": "VT"
    },
    "openingHours": "Mo-Su 06:30-16:00"
  }
  </script>
</head>
<body class="bg-stone-50 text-stone-900 font-serif">
  <nav class="px-6 py-4 border-b border-stone-200">
    <a href="/" class="font-bold">Maple Street Cafe</a>
  </nav>
  <main>
    <section class="px-6 py-16 max-w-3xl mx-auto">
      <h1 class="text-4xl font-bold mb-4">Coffee, the way it's supposed to be.</h1>
      <p class="text-lg">Single-origin pour-overs from beans we roast every Tuesday morning. Sourdough baked at 7am, sold by 10. Open 6:30am to 4pm, every day.</p>
    </section>
  </main>
  <footer class="px-6 py-8 border-t border-stone-200 text-sm">
    <p>1402 Pearl St, Burlington VT &middot; (802) 555-0119</p>
  </footer>
</body>
</html>
`;

  const aboutHtml = `<!DOCTYPE html>
<html lang="en">
<head><title>About — Maple Street Cafe</title></head>
<body><h1>About us</h1><p>We started in 2018 in a converted gas station. Now we roast 4 single-origin coffees a week and bake sourdough fresh every morning.</p></body>
</html>
`;

  const stylesCss = `body { font-family: 'Cambria', Georgia, serif; }
.btn { background: #1B8E8C; color: white; padding: 0.5rem 1rem; border-radius: 0.25rem; }
`;

  await writeFile(join(tempDir, 'index.html'), indexHtml, 'utf8');
  await writeFile(join(tempDir, 'about.html'), aboutHtml, 'utf8');
  await mkdir(join(tempDir, 'css'), { recursive: true });
  await writeFile(join(tempDir, 'css', 'styles.css'), stylesCss, 'utf8');
});

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

/** Patterns that MUST NOT appear in any standalone bundle output. */
const FORBIDDEN_PATTERNS = [
  { pattern: /signalpoint/gi,         label: 'signalpoint reference (any case)' },
  { pattern: /sps_workspace_id/g,      label: 'sps_workspace_id snake-case' },
  { pattern: /spsWorkspaceId/g,        label: 'spsWorkspaceId camel-case' },
  { pattern: /@supabase\/supabase-js/g, label: '@supabase/supabase-js import' },
  { pattern: /signalpoint-config\.json/gi, label: 'signalpoint-config.json reference' },
  { pattern: /SPS_HANDOFF_/g,          label: 'SPS_HANDOFF_ env-var reference' },
];

describe('standalone-IDE guarantee — full-bundle test', () => {
  it('a no-config static project bundle contains zero SPS references', async () => {
    const result = await bundleProject({
      projectId:    '00000000-0000-0000-0000-000000000000',
      projectSlug:  SLUG,
      rootDir:      tempDir,
      entryPoint:   'index.html',
      framework:    'static',
      serveBasePath: '/',
    });

    expect(result.errors, `bundler should not error on static fixture: ${result.errors.join('\n')}`).toEqual([]);
    expect(result.assets.size, 'bundle should produce assets').toBeGreaterThan(0);

    // Decode every asset back to a string and grep for forbidden patterns.
    const decoder = new TextDecoder();
    const violations: Array<{ path: string; pattern: string; matchCount: number }> = [];

    for (const [path, content] of result.assets) {
      // Skip binary assets (images, fonts, etc.) — they can't have leaked
      // text references. Heuristic: if the content has a NUL byte or
      // sufficiently high non-printable density, treat as binary.
      const isLikelyBinary = content.length > 0 && content.indexOf(0) !== -1;
      if (isLikelyBinary) continue;

      const text = decoder.decode(content);
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        const matches = text.match(pattern);
        if (matches && matches.length > 0) {
          violations.push({ path, pattern: label, matchCount: matches.length });
        }
      }
    }

    expect(
      violations,
      'standalone bundle leaks SPS references — see violations array for the file paths and patterns',
    ).toEqual([]);
  });

  it('the bundle includes all source files exactly once', async () => {
    const result = await bundleProject({
      projectId:    '00000000-0000-0000-0000-000000000000',
      projectSlug:  SLUG,
      rootDir:      tempDir,
      entryPoint:   'index.html',
      framework:    'static',
      serveBasePath: '/',
    });

    const paths = [...result.assets.keys()].sort();
    expect(paths).toContain('/index.html');
    expect(paths).toContain('/about.html');
    expect(paths).toContain('/css/styles.css');

    // Sanity: the bundle should NOT include a signalpoint-config.json artifact
    // for a no-config project. (Phase 3 publish flow only writes this file
    // when project.spsWorkspaceId is set + resolveSignalpointConfigForProject
    // returns non-null; the bundler itself never adds it.)
    expect(paths).not.toContain('/signalpoint-config.json');
  });
});
