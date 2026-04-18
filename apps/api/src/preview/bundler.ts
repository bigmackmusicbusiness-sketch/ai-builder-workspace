// apps/api/src/preview/bundler.ts — esbuild-based project bundler.
// Bundles a project's source files into a distributable form for the KV-backed worker.
// Only runs server-side inside /api; never exposed to browser.
import { build, type BuildResult } from 'esbuild';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { redactString } from '../security/redact';

export interface BundleInput {
  projectId: string;
  projectSlug: string;
  /** Absolute path to the project root on disk (temp checkout or workspace dir). */
  rootDir: string;
  entryPoint: string; // relative to rootDir, e.g. "src/main.tsx"
  framework: 'react-vite' | 'vanilla' | 'static';
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
      // Static projects: walk the rootDir and collect all files as-is
      await collectStaticFiles(input.rootDir, input.rootDir, assets);
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
    write: false, // return in-memory
    format: 'esm',
    target: 'es2022',
    minify: false, // keep readable for debugging
    sourcemap: false,
    splitting: false,
    outdir: join(input.rootDir, 'dist'),
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.jsx': 'jsx',
      '.js': 'js',
      '.css': 'css',
      '.svg': 'dataurl',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.gif': 'dataurl',
      '.woff': 'dataurl',
      '.woff2': 'dataurl',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    external: [], // bundle everything for worker compatibility
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
  const jsFile = `/${input.projectSlug}.js`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
