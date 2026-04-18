// apps/api/src/verify/adapters/build.ts — build adapter (vite build / fastify bundle).
// Detects framework from project config, runs the appropriate build command.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AdapterResult, AdapterContext } from '../types';

function detectBuildCommand(root: string): string[] {
  if (existsSync(path.join(root, 'vite.config.ts')) || existsSync(path.join(root, 'vite.config.js'))) {
    return ['pnpm', 'exec', 'vite', 'build'];
  }
  if (existsSync(path.join(root, 'tsconfig.json'))) {
    return ['pnpm', 'exec', 'tsc', '--noEmit'];  // API / worker fallback
  }
  return ['pnpm', 'run', 'build'];
}

export function runBuild(ctx: AdapterContext): AdapterResult {
  const start = Date.now();

  try {
    const [cmd, ...args] = detectBuildCommand(ctx.projectRoot);
    if (!cmd) throw new Error('Could not detect build command');

    const result = spawnSync(cmd, args, {
      cwd:      ctx.projectRoot,
      encoding: 'utf-8',
      timeout:  180_000,
      shell:    process.platform === 'win32',
      env:      { ...process.env, NODE_ENV: 'production' },
    });

    const durationMs = Date.now() - start;

    if (result.error) {
      return {
        adapter: 'build', ok: false, durationMs,
        summary:  `Build spawn error: ${result.error.message}`,
        findings: [], skipped: false,
      };
    }

    const ok     = result.status === 0;
    const output = (result.stdout ?? '') + (result.stderr ?? '');

    const findings = ok ? [] : [{
      severity: 'error' as const,
      message:  output.slice(0, 2000),
      fixable:  false,
    }];

    return {
      adapter: 'build', ok, durationMs,
      summary:  ok ? `Build succeeded in ${durationMs}ms` : `Build failed (exit ${result.status ?? 'unknown'})`,
      findings, skipped: false,
    };
  } catch (err: unknown) {
    return {
      adapter: 'build', ok: false,
      durationMs: Date.now() - start,
      summary:    `Build unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      findings: [], skipped: false,
    };
  }
}
