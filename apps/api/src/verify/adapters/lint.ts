// apps/api/src/verify/adapters/lint.ts — ESLint adapter.
// Runs `pnpm exec eslint` in the project root and parses JSON output.
import { spawnSync } from 'node:child_process';
import type { AdapterResult, AdapterContext } from '../types';

interface EslintMessage {
  severity:  number;  // 1=warn, 2=error
  message:   string;
  ruleId?:   string | null;
  line?:     number;
  column?:   number;
  fix?:      unknown;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

export function runLint(ctx: AdapterContext): AdapterResult {
  const start = Date.now();

  try {
    const result = spawnSync(
      'pnpm',
      ['exec', 'eslint', '.', '--ext', '.ts,.tsx,.js,.jsx', '--format', 'json', '--max-warnings', '0'],
      {
        cwd:      ctx.projectRoot,
        encoding: 'utf-8',
        timeout:  60_000,
        shell:    process.platform === 'win32',
      },
    );

    const durationMs = Date.now() - start;

    if (result.error) {
      return {
        adapter:    'lint',
        ok:         false,
        durationMs,
        summary:    `ESLint spawn error: ${result.error.message}`,
        findings:   [],
        skipped:    false,
      };
    }

    // ESLint exits non-zero when there are errors; parse stdout regardless
    let parsed: EslintFileResult[] = [];
    try {
      parsed = JSON.parse(result.stdout || '[]') as EslintFileResult[];
    } catch {
      return {
        adapter:    'lint',
        ok:         false,
        durationMs,
        summary:    `ESLint output unparseable: ${(result.stdout ?? '').slice(0, 200)}`,
        findings:   [],
        skipped:    false,
      };
    }

    const findings = parsed.flatMap((file) =>
      file.messages.map((msg) => ({
        severity:  (msg.severity === 2 ? 'error' : 'warning') as 'error' | 'warning',
        file:      file.filePath,
        line:      msg.line,
        column:    msg.column,
        message:   msg.message,
        rule:      msg.ruleId ?? undefined,
        fixable:   !!msg.fix,
      })),
    );

    const errorCount = findings.filter((f) => f.severity === 'error').length;
    const warnCount  = findings.filter((f) => f.severity === 'warning').length;
    const ok         = result.status === 0;

    return {
      adapter:    'lint',
      ok,
      durationMs,
      summary:    ok
        ? `ESLint clean (${warnCount} warning${warnCount !== 1 ? 's' : ''})`
        : `ESLint: ${errorCount} error${errorCount !== 1 ? 's' : ''}, ${warnCount} warning${warnCount !== 1 ? 's' : ''}`,
      findings,
      skipped:    false,
    };
  } catch (err: unknown) {
    return {
      adapter:    'lint',
      ok:         false,
      durationMs: Date.now() - start,
      summary:    `ESLint unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      findings:   [],
      skipped:    false,
    };
  }
}
