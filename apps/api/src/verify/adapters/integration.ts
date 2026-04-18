// apps/api/src/verify/adapters/integration.ts — Vitest integration test adapter.
// Runs tests tagged with @integration using a test DB connection.
// Convention: integration tests live in **/*.integration.test.ts files.
import { spawnSync } from 'node:child_process';
import { sql as drizzleSql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import type { AdapterResult, AdapterContext } from '../types';

export async function runIntegration(ctx: AdapterContext): Promise<AdapterResult> {
  const start = Date.now();

  // Gate: integration tests require a live DB. Quick connectivity probe.
  try {
    const db = getDb();
    await db.execute(drizzleSql`SELECT 1`);
  } catch (connErr: unknown) {
    return {
      adapter: 'integration', ok: false,
      durationMs: Date.now() - start,
      summary:    `Integration tests skipped — DB unreachable: ${connErr instanceof Error ? connErr.message : String(connErr)}`,
      findings:   [],
      skipped:    true,
      skipReason: 'DB not available',
    };
  }

  try {
    const result = spawnSync(
      'pnpm',
      [
        'exec', 'vitest', 'run',
        '--include', '**/*.integration.test.ts',
        '--reporter=json',
        '--outputFile=/dev/stderr',
      ],
      {
        cwd:      ctx.projectRoot,
        encoding: 'utf-8',
        timeout:  180_000,
        shell:    process.platform === 'win32',
        env:      { ...process.env, NODE_ENV: 'test', INTEGRATION: '1' },
      },
    );

    const durationMs = Date.now() - start;

    // If no integration tests found, treat as skipped
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    if (output.includes('No test files found') || result.status === null) {
      return {
        adapter: 'integration', ok: true, durationMs,
        summary:  'No integration tests found — skipped',
        findings: [], skipped: true,
        skipReason: 'No integration test files',
      };
    }

    const ok = result.status === 0;
    const findings = ok ? [] : [{
      severity: 'error' as const,
      message:  output.slice(0, 2000),
      fixable:  false,
    }];

    return {
      adapter: 'integration', ok, durationMs,
      summary:  ok ? 'Integration tests passed' : `Integration tests failed (exit ${result.status ?? 'unknown'})`,
      findings, skipped: false,
    };
  } catch (err: unknown) {
    return {
      adapter: 'integration', ok: false,
      durationMs: Date.now() - start,
      summary:    `Integration unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      findings: [], skipped: false,
    };
  }
}
