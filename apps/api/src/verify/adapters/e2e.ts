// apps/api/src/verify/adapters/e2e.ts — Playwright e2e adapter.
// Runs `playwright test` against the preview URL and parses JSON reporter output.
import { spawnSync } from 'node:child_process';
import type { AdapterResult, AdapterContext } from '../types';

interface PlaywrightJsonReport {
  stats?: {
    expected: number;
    unexpected: number;
    flaky: number;
  };
  suites?: PlaywrightSuite[];
}

interface PlaywrightSuite {
  title: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightSpec {
  title: string;
  ok:    boolean;
  tests?: PlaywrightTest[];
  file?: string;
  line?: number;
}

interface PlaywrightTest {
  results?: PlaywrightTestResult[];
}

interface PlaywrightTestResult {
  status: string;
  error?: { message?: string };
}

function collectFailures(suites: PlaywrightSuite[]): Array<{ title: string; file?: string; line?: number; error?: string }> {
  const failures: Array<{ title: string; file?: string; line?: number; error?: string }> = [];
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      if (!spec.ok) {
        const error = spec.tests?.flatMap((t) => t.results ?? []).find((r) => r.error)?.error?.message;
        failures.push({ title: `${suite.title} > ${spec.title}`, file: spec.file, line: spec.line, error });
      }
    }
    if (suite.suites) failures.push(...collectFailures(suite.suites));
  }
  return failures;
}

export function runE2e(ctx: AdapterContext): AdapterResult {
  const start = Date.now();

  if (!ctx.previewUrl) {
    return {
      adapter: 'e2e', ok: true,
      durationMs: Date.now() - start,
      summary:    'E2E skipped — preview URL not available',
      findings:   [], skipped: true,
      skipReason: 'No preview URL',
    };
  }

  try {
    const result = spawnSync(
      'pnpm',
      ['exec', 'playwright', 'test', '--reporter=json'],
      {
        cwd:      ctx.projectRoot,
        encoding: 'utf-8',
        timeout:  300_000,
        shell:    process.platform === 'win32',
        env:      {
          ...process.env,
          PLAYWRIGHT_BASE_URL: ctx.previewUrl,
          CI: '1',
        },
      },
    );

    const durationMs = Date.now() - start;
    const rawJson    = result.stdout ?? '';

    if (result.error) {
      return {
        adapter: 'e2e', ok: false, durationMs,
        summary:  `Playwright spawn error: ${result.error.message}`,
        findings: [], skipped: false,
      };
    }

    // No e2e test files
    if ((rawJson + result.stderr).includes('No test files found')) {
      return {
        adapter: 'e2e', ok: true, durationMs,
        summary:  'No e2e tests found — skipped',
        findings: [], skipped: true,
        skipReason: 'No e2e test files',
      };
    }

    let report: PlaywrightJsonReport = {};
    try { report = JSON.parse(rawJson) as PlaywrightJsonReport; } catch { /* ignore */ }

    const failures = collectFailures(report.suites ?? []);
    const ok       = result.status === 0 && failures.length === 0;
    const expected = report.stats?.expected ?? 0;

    const findings = failures.map((f) => ({
      severity: 'error' as const,
      file:     f.file,
      line:     f.line,
      message:  `${f.title}${f.error ? `: ${f.error.slice(0, 400)}` : ''}`,
      fixable:  false,
    }));

    return {
      adapter: 'e2e', ok, durationMs,
      summary:  ok
        ? `E2E: ${expected} test${expected !== 1 ? 's' : ''} passed`
        : `E2E: ${failures.length} failure${failures.length !== 1 ? 's' : ''}`,
      findings, skipped: false,
    };
  } catch (err: unknown) {
    return {
      adapter: 'e2e', ok: false,
      durationMs: Date.now() - start,
      summary:    `E2E unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      findings: [], skipped: false,
    };
  }
}
