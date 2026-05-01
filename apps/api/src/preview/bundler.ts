// apps/api/src/preview/bundler.ts — esbuild-based project bundler.
// Bundles a project's source files into a distributable form for the KV-backed worker.
// Only runs server-side inside /api; never exposed to browser.
import { build, type BuildResult } from 'esbuild';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactString } from '../security/redact';

// ── Module resolution paths ────────────────────────────────────────────────────
// esbuild resolves imports from the project root, but scaffolded/user projects
// don't have their own node_modules. Point esbuild at the monorepo node_modules
// so packages like react, react-dom, etc. are found automatically.
//
// CJS-vs-ESM resolution: when esbuild bundles this file to CJS, `__dirname` is
// a module-local free variable (not on globalThis) and `import.meta.url` is
// undefined (causing fileURLToPath to crash). When run as ESM source it's the
// inverse. `typeof __dirname` returns 'string' in CJS and 'undefined' in ESM
// without throwing — safe to use as the runtime probe.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const _dirname: string = (typeof __dirname === 'string')
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));
// apps/api/src/preview -> apps/api -> apps -> monorepo root
const MONOREPO_ROOT     = join(_dirname, '..', '..', '..', '..', '..');
const ROOT_NODE_MODULES = join(MONOREPO_ROOT, 'node_modules');
const API_NODE_MODULES  = join(_dirname, '..', '..', '..', 'node_modules');

export interface BundleInput {
  projectId: string;
  projectSlug: string;
  /** Absolute path to the project root on disk (temp checkout or workspace dir). */
  rootDir: string;
  entryPoint: string; // relative to rootDir, e.g. "src/main.tsx"
  framework: 'react-vite' | 'vanilla' | 'static';
  /**
   * For static sites: the URL base path from which assets are served.
   * E.g. "/api/preview/serve/my-project/" in local dev, "/" in production.
   * A <base href="…"> tag is injected into index.html so that relative asset
   * paths (images/hero.jpg) resolve correctly even when the page is served
   * from a sub-path. Absolute paths (/images/…) in the HTML are also rewritten
   * to relative so they respect the base tag.
   */
  serveBasePath?: string;
}

export interface BundleOutput {
  /** Map of `/<path>` → Buffer (the asset content to write to KV). */
  assets: Map<string, Uint8Array>;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

/** Bundle a React/Vite project with esbuild.
 *  Output: assets map ready to push to Cloudflare KV.
 */
export async function bundleProject(input: BundleInput): Promise<BundleOutput> {
  const t0 = Date.now();
  const assets = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    if (input.framework === 'static') {
      // Static projects: walk the rootDir and collect all files as-is (no bundling)
      await collectStaticFiles(input.rootDir, input.rootDir, assets);

      // Patch index.html so assets resolve correctly when served from a sub-path.
      // Order matters: rewrite absolute paths FIRST, then inject the base tag —
      // otherwise the rewriter will strip the leading slash from the base href itself.
      if (input.serveBasePath) {
        const raw = assets.get('/index.html');
        if (raw) {
          let html = new TextDecoder().decode(raw);
          // Step 1: Rewrite absolute-path src/href="/foo" → "foo" (drop leading slash)
          // so they resolve relative to the base href instead of the server root.
          // Skips external URLs (http://, https://, //) and the base tag itself.
          html = html.replace(
            /(src|href)="\/(?!\/|http[s]?:\/\/)([^"]*)"/gi,
            '$1="$2"',
          );
          // Step 2: Inject <base href="…"> AFTER rewriting (so the rewriter
          // cannot strip its leading slash). Skip if already present.
          if (!html.includes('<base ')) {
            const baseTag = `<base href="${input.serveBasePath}">`;
            html = html.replace(/(<head[^>]*>)/i, `$1\n  ${baseTag}`);
          }
          assets.set('/index.html', encodeText(html));
        }
      }
    } else {
      // React/Vite and vanilla: use esbuild
      const result = await buildWithEsbuild(input);

      for (const file of result.outputFiles ?? []) {
        const rel = '/' + relative(join(input.rootDir, 'dist'), file.path).replace(/\\/g, '/');
        assets.set(rel, file.contents);
      }

      for (const w of result.warnings) {
        warnings.push(redactString(w.text));
      }
      for (const e of result.errors) {
        errors.push(redactString(e.text));
      }

      // Inject a minimal index.html if none was produced
      if (!assets.has('/index.html')) {
        assets.set('/index.html', encodeText(buildIndexHtml(input)));
      }
    }
  } catch (err: unknown) {
    errors.push(redactString(String(err instanceof Error ? err.message : err)));
  }

  return { assets, warnings, errors, durationMs: Date.now() - t0 };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function buildWithEsbuild(input: BundleInput): Promise<BuildResult> {
  return build({
    entryPoints: [join(input.rootDir, input.entryPoint)],
    bundle: true,
    write: false,         // return in-memory
    format: 'esm',
    target: 'es2022',
    minify: false,        // keep readable for debugging
    sourcemap: false,
    splitting: false,
    outdir: join(input.rootDir, 'dist'),
    loader: {
      '.tsx': 'tsx',
      '.ts':  'ts',
      '.jsx': 'jsx',
      '.js':  'js',
      '.css': 'css',
      '.svg': 'dataurl',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.gif': 'dataurl',
      '.woff':  'dataurl',
      '.woff2': 'dataurl',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    // Point esbuild at the monorepo node_modules so imports like 'react',
    // 'react-dom/client' etc. resolve correctly even in temp/scaffolded dirs.
    nodePaths: [ROOT_NODE_MODULES, API_NODE_MODULES],
    // Bundle everything — worker-compatible ESM output
    external: [],
  });
}

async function collectStaticFiles(
  baseDir: string,
  dir: string,
  assets: Map<string, Uint8Array>,
): Promise<void> {
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      await collectStaticFiles(baseDir, full, assets);
    } else {
      const rel = '/' + relative(baseDir, full).replace(/\\/g, '/');
      const buf = await readFile(full);
      assets.set(rel, buf);
    }
  }
}

function buildIndexHtml(input: BundleInput): string {
  // Normalise the entry point filename to match esbuild's output naming
  const jsName  = input.entryPoint.replace(/^src\//, '').replace(/\.[^.]+$/, '.js');
  const jsFile  = `/${jsName}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${input.projectSlug}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${jsFile}"></script>
</body>
</html>`;
}

function encodeText(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// Exported so tests can inspect without full build
export { buildIndexHtml };
