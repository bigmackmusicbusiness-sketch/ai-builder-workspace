// apps/api/src/preview/scaffold.ts — writes a minimal Hello World project
// to a temp directory so the bundler has real files to serve.
// Returns { dir, framework: 'static' } — no bundling needed, just HTML.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface ScaffoldResult {
  /** Absolute path to the scaffolded directory. */
  dir: string;
  /** Framework hint — 'static' means serve files as-is; no esbuild needed. */
  framework: 'static';
}

export async function scaffoldHelloWorld(projectSlug: string): Promise<ScaffoldResult> {
  const dir = join(tmpdir(), `abw-preview-${projectSlug}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });

  // Self-contained static HTML — no npm dependencies, no bundler required.
  // When real project files exist on disk, the bundler takes over instead.
  await writeFile(
    join(dir, 'index.html'),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${projectSlug}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f9f9fb;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 48px 40px;
      text-align: center;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,.06);
    }
    .rocket { font-size: 56px; margin-bottom: 20px; }
    h1 { font-size: 26px; font-weight: 700; color: #111; margin-bottom: 10px; }
    p  { color: #6b7280; font-size: 15px; line-height: 1.65; margin-bottom: 24px; }
    .badge {
      display: inline-block;
      background: #f0f0ff;
      color: #6c47ff;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 99px;
      border: 1px solid #ddd6fe;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="rocket">🚀</div>
    <h1>${projectSlug}</h1>
    <p>
      Your project is live in the preview sandbox.<br />
      Ask the AI to build something and it will appear here.
    </p>
    <span class="badge">SignalPoint IDE</span>
  </div>
</body>
</html>`,
  );

  return { dir, framework: 'static' };
}
