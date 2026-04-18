// apps/api/src/verify/adapters/unit.ts — Vitest unit test adapter.
// Runs `vitest run` (no watch) and parses JSON reporter output.
import { spawnSync } from 'node:child_process';
import type { AdapterResult, AdapterContext } from '../types';

interface VitestJsonResult {
  numFailedTests:   number;
  numPassedTests:   number;
  numPendingTests:  number;
  numTotalTests:    number;
  testResults?:     VitestFileResult[];
}

interface VitestFileResult {
  testFilePath: string;
  assertionResults?: VitestAssertion[];
}

interface VitestAssertion {
  status:   'passed' | 'failed' | 'pending';
  fullName: string;
  failureMessages?: string[];
  location?: { line?: number; column?: number };
}

export function runUnit(ctx: AdapterContext): AdapterResult {
  const start = Date.now();

  try {
    const result = spawnSync(
      'pnpm',
      ['exec', 'vitest', 'run', '--reporter=json', '--outputFile=/dev/stderr'],
      {
        cwd:      ctx.projectRoot,
        encoding: 'utf-8',
        timeout:  120_000,
        shell:    process.platform === 'win32',
        env:      { ...process.env, NODE_ENV: 'test' },
      },
    );

    const durationMs = Date.now() - start;

    // Vitest writes JSON to stderr when using --outputFile=/dev/stderr
    const rawJson = result.stderr ?? result.stdout ?? '';
    let parsed: VitestJsonResult | null = null;

    // Extract JSON block (Vitest may mix logs + JSON)
    const jsonMatch = rawJson.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]) as VitestJsonResult; } catch { /* ignore */ }
    }

    if (!parsed) {
      // Fallback: just check exit code
      const ok = result.status === 0;
      return {
        adapter: 'unit', ok, durationMs,
        summary:  ok ? 'Unit tests passed' : `Unit tests failed (exit ${result.status ?? 'unknown'})`,
        findings: ok ? [] : [{
          severity: 'error' as const,
          message:  (result.stdout ?? result.stderr ?? '').slice(0, 2000),
          fixable:  false,
        }],
        skipped: false,
      };
    }

    const findings = (parsed.testResults ?? []).flatMap((file) =>
      (file.assertionResults ?? [])
        .filter((a) => a.status === 'failed')
        .map((a) => ({
          severity: 'error' as const,
          file:     file.testFilePath,
          line:     a.location?.line,
          column:   a.location?.column,
          message:  `${a.fullName}: ${(a.failureMessages ?? []).join(' ')}`.slice(0, 500),
          fixable:  false,
        })),
    );

    const ok      = parsed.numFailedTests === 0;
    const passed  = parsed.numPassedTests;
    const failed  = parsed.numFailedTests;
    const total   = parsed.numTotalTests;

    return {
      adapter: 'unit', ok, durationMs,
      summary:  `${passed}/${total} tests passed${failed > 0 ? ` (${failed} failed)` : ''}`,
      findings, skipped: false,
    };
  } catch (err: unknown) {
    return {
      adapter: 'unit', ok: false,
      durationMs: Date.now() - start,
      summary:    `Vitest unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      findings: [], skipped: false,
    };
  }
}
