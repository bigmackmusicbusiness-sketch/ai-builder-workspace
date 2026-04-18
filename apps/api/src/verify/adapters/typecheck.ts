// apps/api/src/verify/adapters/typecheck.ts — TypeScript type-check adapter.
// Runs `tsc --noEmit` and parses diagnostics from stderr/stdout.
import { spawnSync } from 'node:child_process';
import type { AdapterResult, AdapterContext } from '../types';

// Matches: src/foo.ts(12,5): error TS2345: Argument…
const TSC_DIAG = /^(.+?)\((\d+),(\d+)\):\s+(error|warning|message)\s+(TS\d+):\s+(.+)$/;

export function runTypecheck(ctx: AdapterContext): AdapterResult {
  const start = Date.now();

  try {
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsc', '--noEmit', '--pretty', 'false'],
      {
        cwd:      ctx.projectRoot,
        encoding: 'utf-8',
        timeout:  120_000,
        shell:    process.platform === 'win32',
      },
    );

    const durationMs = Date.now() - start;

    if (result.error) {
      return {
        adapter:    'typecheck',
        ok:         false,
        durationMs,
        summary:    `tsc spawn error: ${result.error.message}`,
        findings:   [],
        skipped:    false,
      };
    }

    const raw    = (result.stdout ?? '') + (result.stderr ?? '');
    const lines  = raw.split('\n');
    const findings = lines
      .map((line) => {
        const m = TSC_DIAG.exec(line.trim());
        if (!m) return null;
        const [, file, lineNo, colNo, sevStr, code, message] = m;
        const severity = sevStr === 'error' ? 'error' : sevStr === 'warning' ? 'warning' : 'info';
        return {
          severity: severity as 'error' | 'warning' | 'info',
          file:     file?.trim(),
          line:     Number(lineNo),
          column:   Number(colNo),
          message:  `${code}: ${message}`,
          fixable:  false,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    const errorCount = findings.filter((f) => f.severity === 'error').length;
    const ok         = result.status === 0;

    return {
      adapter:    'typecheck',
      ok,
      durationMs,
      summary:    ok
        ? 'TypeScript: no errors'
        : `TypeScript: ${errorCount} error${errorCount !== 1 ? 's' : ''}`,
      findings,
      skipped:    false,
    };
  } catch (err: unknown) {
    return {
      adapter:    'typecheck',
      ok:         false,
      durationMs: Date.now() - start,
      summary:    `tsc unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      findings:   [],
      skipped:    false,
    };
  }
}
