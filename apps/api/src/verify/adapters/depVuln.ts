// apps/api/src/verify/adapters/depVuln.ts — dependency vulnerability adapter.
// Runs `pnpm audit --json` and parses advisories.
import { spawnSync } from 'node:child_process';
import type { AdapterResult, AdapterContext } from '../types';

interface PnpmAuditReport {
  metadata?: {
    vulnerabilities?: {
      critical?: number;
      high?:     number;
      moderate?: number;
      low?:      number;
      info?:     number;
      total?:    number;
    };
  };
  advisories?: Record<string, PnpmAdvisory>;
}

interface PnpmAdvisory {
  module_name:        string;
  severity:           string;
  title:              string;
  url?:               string;
  recommendation?:    string;
  vulnerable_versions?: string;
}

export function runDepVuln(ctx: AdapterContext): AdapterResult {
  const start = Date.now();

  try {
    const result = spawnSync('pnpm', ['audit', '--json'], {
      cwd:      ctx.projectRoot,
      encoding: 'utf-8',
      timeout:  60_000,
      shell:    process.platform === 'win32',
    });

    const durationMs = Date.now() - start;

    if (result.error) {
      return {
        adapter: 'depVuln', ok: false, durationMs,
        summary:  `pnpm audit spawn error: ${result.error.message}`,
        findings: [], skipped: false,
      };
    }

    let report: PnpmAuditReport = {};
    try { report = JSON.parse(result.stdout ?? '{}') as PnpmAuditReport; } catch { /* ignore */ }

    const vuln    = report.metadata?.vulnerabilities ?? {};
    const critical = vuln.critical ?? 0;
    const high     = vuln.high ?? 0;
    const total    = vuln.total ?? 0;

    // Fail on critical or high; warn on moderate
    const ok = critical === 0 && high === 0;

    const advisories = Object.values(report.advisories ?? {});
    const findings = advisories
      .filter((a) => ['critical', 'high', 'moderate'].includes(a.severity))
      .map((a) => ({
        severity: (a.severity === 'critical' || a.severity === 'high' ? 'error' : 'warning') as 'error' | 'warning',
        message:  `${a.module_name} (${a.severity}): ${a.title}${a.recommendation ? ` — ${a.recommendation}` : ''}`,
        rule:     a.url,
        fixable:  !!a.recommendation,
      }));

    return {
      adapter: 'depVuln', ok, durationMs,
      summary:  total === 0
        ? 'No dependency vulnerabilities found'
        : `Vulnerabilities: ${critical} critical, ${high} high (${total} total)`,
      findings, skipped: false,
    };
  } catch (err: unknown) {
    return {
      adapter: 'depVuln', ok: false,
      durationMs: Date.now() - start,
      summary:    `Dep-vuln unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      findings: [], skipped: false,
    };
  }
}
