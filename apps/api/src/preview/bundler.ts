// apps/api/src/preview/bundler.ts — esbuild-based project bundler.
// Bundles a project's source files into a distributable form for the KV-backed worker.
// Only runs server-side inside /api; never exposed to browser.
import { build, type BuildResult } from 'esbuild';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { redactString } from '../security/redact';

// ── Hot bundle cache (Phase C.4) ───────────────────────────────────────────────
// Cold rebuild on every preview boot was the dominant latency cost; for a
// scaffolded project the same source produces the same bundle every time.
// Cache the assets map keyed by a hash of the file tree so a cold-restart of
// the same project hits the cache instead of re-running esbuild.
//
// In-memory LRU; capped at MAX_ENTRIES so memory stays bounded. Coolify
// migration to Redis can swap this with the same interface intact.
interface CachedBundle {
  assets:    Map<string, Uint8Array>;
  warnings:  string[];
  errors:    string[];
  durationMs: number;
  lastUsed:  number;
}
const BUNDLE_CACHE = new Map<string, CachedBundle>();
const MAX_CACHE_ENTRIES = 32;          // ~tens of MB at scaffold size
const MAX_TREE_BYTES_FOR_CACHE = 50_000_000; // skip caching projects > 50MB

/** Walk the project root and produce a content-stable digest of every file
 *  path + size + mtime + framework + entrypoint. mtime is sufficient because
 *  saveFile() always rewrites the file (path or contentHash changes), and
 *  esbuild's resolution is deterministic from these inputs. */
async function computeTreeHash(input: BundleInput): Promise<{ hash: string; totalBytes: number } | null> {
  const entries: Array<{ path: string; size: number; mtimeMs: number }> = [];
  let totalBytes = 0;

  async function walk(dir: string): Promise<void> {
    let names: string[];
    try { names = await readdir(dir); } catch { return; }
    for (const name of names) {
      if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
      const full = join(dir, name);
      let st;
      try { st = await stat(full); } catch { continue; }
      if (st.isDirectory()) {
        await walk(full);
      } else {
        const rel = relative(input.rootDir, full).replace(/\\/g, '/');
        entries.push({ path: rel, size: st.size, mtimeMs: st.mtimeMs });
        totalBytes += st.size;
        if (totalBytes > MAX_TREE_BYTES_FOR_CACHE) return; // bail; don't cache giant trees
      }
    }
  }
  await walk(input.rootDir);
  if (totalBytes > MAX_TREE_BYTES_FOR_CACHE) return null;

  entries.sort((a, b) => a.path.localeCompare(b.path));
  const payload = JSON.stringify({
    framework:  input.framework,
    entry:      input.entryPoint,
    base:       input.serveBasePath ?? '',
    files:      entries,
  });
  const hash = createHash('sha256').update(payload).digest('hex');
  return { hash, totalBytes };
}

function cacheKey(slug: string, treeHash: string): string {
  return `${slug}:${treeHash}`;
}

function evictLRUIfFull(): void {
  if (BUNDLE_CACHE.size <= MAX_CACHE_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestUsed = Infinity;
  for (const [k, v] of BUNDLE_CACHE) {
    if (v.lastUsed < oldestUsed) { oldestUsed = v.lastUsed; oldestKey = k; }
  }
  if (oldestKey) BUNDLE_CACHE.delete(oldestKey);
}

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
 *
 *  Phase C.4: cache by tree hash so identical source maps to a cache HIT
 *  on subsequent boots. esbuild on a tiny scaffold runs ~200-500ms; the
 *  cache turns that into <5ms. Cache invalidates automatically when any
 *  file's mtime/size changes (so saveFile() naturally busts it).
 */
export async function bundleProject(input: BundleInput): Promise<BundleOutput> {
  const t0 = Date.now();

  // Cache lookup
  const tree = await computeTreeHash(input);
  if (tree) {
    const key = cacheKey(input.projectSlug, tree.hash);
    const hit = BUNDLE_CACHE.get(key);
    if (hit) {
      hit.lastUsed = Date.now();
      console.log(`[bundler] cache HIT ${input.projectSlug} (${tree.hash.slice(0, 8)}, served in ${Date.now() - t0}ms)`);
      return {
        // Defensive copy of the assets map so callers can mutate without
        // poisoning the cached entry.
        assets:     new Map(hit.assets),
        warnings:   [...hit.warnings],
        errors:     [...hit.errors],
        durationMs: Date.now() - t0,
      };
    }
    console.log(`[bundler] cache MISS ${input.projectSlug} (${tree.hash.slice(0, 8)}, ${tree.totalBytes}B)`);
  }

  const assets = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    if (input.framework === 'static') {
      // Static projects: walk the rootDir and collect all files as-is (no bundling)
      await collectStaticFiles(input.rootDir, input.rootDir, assets);

      // Patch EVERY .html file so assets resolve correctly when served from a
      // sub-path. Prior version only patched /index.html, which meant sub-pages
      // (menu.html, about.html, etc.) shipped <img src="/images/X.jpg">
      // references that resolved to the api root (/images/X.jpg) instead of
      // the slug sub-path (/api/preview/serve/<slug>/images/X.jpg) → 404 on
      // every image. Apply the same two-step rewrite-then-inject pass to all
      // HTML files in the bundle.
      // Order matters: rewrite absolute paths FIRST, then inject the base tag —
      // otherwise the rewriter will strip the leading slash from the base href itself.
      if (input.serveBasePath) {
        for (const [path, raw] of assets) {
          if (!path.toLowerCase().endsWith('.html') && !path.toLowerCase().endsWith('.htm')) continue;
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
          assets.set(path, encodeText(html));
        }
      }
    } else {
      // React/Vite and vanilla: use esbuild
      let esbuildProducedNothing = false;
      try {
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

        // esbuild can return an empty outputFiles list (e.g. when scaffolded
        // React deps aren't in the monorepo's node_modules and every import
        // resolves to undefined). Without the explicit signal below this is
        // a silent failure — the bundler returns an empty asset map, the
        // preview-serve route fabricates an index.html that references
        // `/main.js` which doesn't exist, and the browser shows a blank
        // dark screen. Detect that case and fall back to static collection.
        const hasJs = Array.from(assets.keys()).some((k) => k.endsWith('.js'));
        if (!hasJs && (result.outputFiles?.length ?? 0) === 0) {
          esbuildProducedNothing = true;
        }
      } catch (esbuildErr) {
        // esbuild threw outright (resolution failure, syntax error in
        // a workspace file, etc.). Capture the error and fall through to
        // static collection so the user sees SOMETHING — either the agent's
        // HTML pages or a stub message, never a silent dark void.
        errors.push(redactString(String(esbuildErr instanceof Error ? esbuildErr.message : esbuildErr)));
        esbuildProducedNothing = true;
      }

      if (esbuildProducedNothing) {
        warnings.push(
          `esbuild produced no output for "${input.entryPoint}" — falling back to static asset collection. ` +
          `This usually means scaffolded React deps weren't installed (workspace has src/main.tsx but no node_modules). ` +
          `Serving whatever HTML/CSS/JS files the agent wrote directly.`,
        );
        // Clear errors that came from the esbuild attempt — they're now
        // a warning, not a fatal. The fallback IS the recovery path.
        errors.length = 0;
        try {
          await collectStaticFiles(input.rootDir, input.rootDir, assets);
        } catch (collectErr) {
          errors.push(redactString(String(collectErr instanceof Error ? collectErr.message : collectErr)));
        }
      }

      // Inject a minimal index.html if none was produced — but only if we
      // truly have no HTML at all. If the static fallback above grabbed a
      // user-written index.html, that takes precedence over the synthetic
      // one that imports a nonexistent `/main.js`.
      if (!assets.has('/index.html')) {
        assets.set('/index.html', encodeText(buildIndexHtml(input)));
      }
    }
  } catch (err: unknown) {
    errors.push(redactString(String(err instanceof Error ? err.message : err)));
  }

  const durationMs = Date.now() - t0;

  // Cache the result if we computed a tree hash and the bundle had no errors.
  // (Caching errored bundles would just replay the failure on every retry.)
  if (tree && errors.length === 0) {
    evictLRUIfFull();
    BUNDLE_CACHE.set(cacheKey(input.projectSlug, tree.hash), {
      // Cache copies of the assets so the caller can freely mutate the
      // returned map without poisoning the cache.
      assets:    new Map(assets),
      warnings:  [...warnings],
      errors:    [...errors],
      durationMs,
      lastUsed:  Date.now(),
    });
  }

  return { assets, warnings, errors, durationMs };
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
