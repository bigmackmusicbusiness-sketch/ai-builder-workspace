// apps/web/src/layout/MainWorkspace/modes/TestsMode.tsx — verification matrix UI.
// Shows all adapters with last-run status, duration, findings count.
// "Run all" and per-row run buttons POST to /api/tests/run.
import { Fragment, useState, useCallback } from 'react';
import { useRunStore } from '../../../lib/store/runStore';

// ── Types ─────────────────────────────────────────────────────────────────────

type AdapterStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped' | 'warning';

interface AdapterFinding {
  severity: 'error' | 'warning' | 'info';
  file?:    string;
  line?:    number;
  message:  string;
  rule?:    string;
  fixable:  boolean;
}

interface MatrixRow {
  adapter:    string;
  label:      string;
  status:     AdapterStatus;
  durationMs: number | null;
  summary:    string;
  findings:   AdapterFinding[];
  skipped:    boolean;
  expanded:   boolean;
}

// ── Adapter definitions ───────────────────────────────────────────────────────

const ADAPTER_META: { adapter: string; label: string; description: string }[] = [
  { adapter: 'lint',              label: 'ESLint',            description: 'Style & correctness rules' },
  { adapter: 'typecheck',         label: 'TypeScript',        description: 'Type checking (tsc --noEmit)' },
  { adapter: 'build',             label: 'Build',             description: 'Vite build / bundle' },
  { adapter: 'unit',              label: 'Unit tests',        description: 'Vitest unit suite' },
  { adapter: 'integration',       label: 'Integration',       description: 'Vitest with test DB' },
  { adapter: 'e2e',               label: 'E2E',               description: 'Playwright end-to-end' },
  { adapter: 'secretScan',        label: 'Secret scan',       description: 'Detect leaked credentials' },
  { adapter: 'depVuln',           label: 'Dep-vuln',          description: 'pnpm audit vulnerabilities' },
  { adapter: 'migrationSmoke',    label: 'Migration smoke',   description: 'Apply + rollback on test DB' },
  { adapter: 'playwrightRuntime', label: 'Runtime check',     description: 'Boot + console error scrape' },
  { adapter: 'screenshotDiff',    label: 'Screenshot diff',   description: 'Visual regression at 360/768/1280' },
];

function initRows(): MatrixRow[] {
  return ADAPTER_META.map((m) => ({
    ...m,
    status:     'idle',
    durationMs: null,
    summary:    '—',
    findings:   [],
    skipped:    false,
    expanded:   false,
  }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AdapterStatus }) {
  const map: Record<AdapterStatus, { label: string; color: string }> = {
    idle:    { label: 'Idle',    color: 'var(--text-tertiary)' },
    running: { label: 'Running…',color: 'var(--color-accent)' },
    passed:  { label: 'Passed',  color: 'var(--success-500)' },
    failed:  { label: 'Failed',  color: 'var(--error-500)' },
    skipped: { label: 'Skipped', color: 'var(--text-secondary)' },
    warning: { label: 'Warning', color: 'var(--warning-500)' },
  };
  const { label, color } = map[status];
  return (
    <span style={{ color, fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
      {status === 'running' ? (
        <span className="abw-agent-status__dot abw-agent-status__dot--running" style={{ marginRight: 4 }} aria-hidden />
      ) : null}
      {label}
    </span>
  );
}

function FindingRow({ f }: { f: AdapterFinding }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '60px 1fr',
      gap: 'var(--space-1)',
      padding: 'var(--space-1) 0',
      borderBottom: '1px solid var(--border-subtle)',
      fontSize: '0.6875rem',
      color: f.severity === 'error' ? 'var(--error-500)' : f.severity === 'warning' ? 'var(--warning-500)' : 'var(--text-secondary)',
    }}>
      <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{f.severity}</span>
      <span>
        {f.file && <span style={{ opacity: 0.7 }}>{f.file}{f.line ? `:${f.line}` : ''} — </span>}
        {f.message}
        {f.rule && <span style={{ opacity: 0.5, marginLeft: 4 }}>[{f.rule}]</span>}
        {f.fixable && <span style={{ color: 'var(--success-500)', marginLeft: 4 }}>✓ auto-fixable</span>}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TestsMode() {
  const [rows, setRows]     = useState<MatrixRow[]>(initRows);
  const [running, setRunning] = useState<string | null>(null);  // 'all' | adapter name

  const { activeRun } = useRunStore();

  const markRow = useCallback((
    adapter: string,
    patch: Partial<MatrixRow>,
  ) => {
    setRows((prev) => prev.map((r) => r.adapter === adapter ? { ...r, ...patch } : r));
  }, []);

  const runAdapter = useCallback(async (adapter: string) => {
    if (running) return;
    setRunning(adapter);
    markRow(adapter, { status: 'running', findings: [], summary: 'Running…' });

    try {
      const res = await fetch('/api/tests/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          projectId:   activeRun?.id ?? '00000000-0000-0000-0000-000000000000',
          projectRoot: '.',
          adapters:    [adapter],
        }),
      });
      const data = await res.json() as { results?: Array<{ adapter: string; ok: boolean; durationMs: number; summary: string; findings: AdapterFinding[]; skipped: boolean }> };
      const r    = data.results?.[0];
      if (r) {
        markRow(adapter, {
          status:     r.skipped ? 'skipped' : r.ok ? 'passed' : 'failed',
          durationMs: r.durationMs,
          summary:    r.summary,
          findings:   r.findings ?? [],
          skipped:    r.skipped,
        });
      }
    } catch (err: unknown) {
      markRow(adapter, {
        status:  'failed',
        summary: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setRunning(null);
    }
  }, [running, activeRun, markRow]);

  const runAll = useCallback(async () => {
    if (running) return;
    setRunning('all');
    setRows((prev) => prev.map((r) => ({ ...r, status: 'running', findings: [], summary: 'Running…' })));

    try {
      const res = await fetch('/api/tests/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          projectId:   activeRun?.id ?? '00000000-0000-0000-0000-000000000000',
          projectRoot: '.',
        }),
      });
      const data = await res.json() as { results?: Array<{ adapter: string; ok: boolean; durationMs: number; summary: string; findings: AdapterFinding[]; skipped: boolean }> };
      for (const r of data.results ?? []) {
        markRow(r.adapter, {
          status:     r.skipped ? 'skipped' : r.ok ? 'passed' : 'failed',
          durationMs: r.durationMs,
          summary:    r.summary,
          findings:   r.findings ?? [],
          skipped:    r.skipped,
        });
      }
    } catch (err: unknown) {
      setRows((prev) => prev.map((r) =>
        r.status === 'running' ? { ...r, status: 'failed', summary: err instanceof Error ? err.message : 'Network error' } : r,
      ));
    } finally {
      setRunning(null);
    }
  }, [running, activeRun, markRow]);

  const toggleExpand = (adapter: string) => {
    setRows((prev) => prev.map((r) => r.adapter === adapter ? { ...r, expanded: !r.expanded } : r));
  };

  const passed  = rows.filter((r) => r.status === 'passed').length;
  const failed  = rows.filter((r) => r.status === 'failed').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;
  const total   = rows.length;

  return (
    <div className="abw-tests-mode">
      {/* Header */}
      <div className="abw-tests-mode__header">
        <div>
          <h2 className="abw-tests-mode__title">Verification Matrix</h2>
          <p className="abw-tests-mode__sub">
            {running ? 'Running…' : (
              passed + failed + skipped > 0
                ? `${passed} passed · ${failed} failed · ${skipped} skipped (${total} adapters)`
                : 'Run checks to see results'
            )}
          </p>
        </div>
        <button
          className="abw-btn abw-btn--primary abw-btn--sm"
          onClick={() => void runAll()}
          disabled={!!running}
          aria-busy={running === 'all'}
        >
          {running === 'all' ? 'Running…' : '▶ Run all'}
        </button>
      </div>

      {/* Summary bar */}
      {(passed + failed + skipped) > 0 && (
        <div className="abw-tests-mode__summary-bar">
          <span style={{ background: 'var(--success-500)', width: `${(passed / total) * 100}%` }} />
          <span style={{ background: 'var(--error-500)', width: `${(failed / total) * 100}%` }} />
          <span style={{ background: 'var(--border-base)', width: `${(skipped / total) * 100}%` }} />
        </div>
      )}

      {/* Matrix table */}
      <div className="abw-tests-mode__table-wrap">
        <table className="abw-tests-mode__table" aria-label="Verification matrix">
          <thead>
            <tr>
              <th style={{ width: 160 }}>Adapter</th>
              <th style={{ width: 100 }}>Status</th>
              <th style={{ width: 80 }}>Duration</th>
              <th style={{ width: 60 }}>Findings</th>
              <th>Summary</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.adapter}>
                <tr
                  className={`abw-tests-mode__row abw-tests-mode__row--${row.status}`}
                  onClick={() => row.findings.length > 0 && toggleExpand(row.adapter)}
                  style={{ cursor: row.findings.length > 0 ? 'pointer' : 'default' }}
                  aria-expanded={row.expanded}
                >
                  <td>
                    <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{row.label}</span>
                    <span style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                      {(ADAPTER_META.find((m) => m.adapter === row.adapter))?.description}
                    </span>
                  </td>
                  <td><StatusBadge status={row.status} /></td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {row.durationMs !== null ? `${row.durationMs}ms` : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {row.findings.length > 0 ? (
                      <span style={{
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        color: row.findings.some((f) => f.severity === 'error') ? 'var(--error-500)' : 'var(--warning-500)',
                      }}>
                        {row.findings.length}
                      </span>
                    ) : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.summary}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="abw-btn abw-btn--ghost abw-btn--xs"
                      onClick={(e) => { e.stopPropagation(); void runAdapter(row.adapter); }}
                      disabled={!!running}
                      aria-label={`Run ${row.label}`}
                    >
                      ▶
                    </button>
                  </td>
                </tr>

                {/* Expanded findings */}
                {row.expanded && row.findings.length > 0 && (
                  <tr className="abw-tests-mode__findings-row">
                    <td colSpan={6}>
                      <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-base)' }}>
                        {row.findings.map((f, i) => (
                          <FindingRow key={i} f={f} />
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Empty state */}
      {rows.every((r) => r.status === 'idle') && (
        <div className="abw-mode-placeholder" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <span className="abw-mode-placeholder__icon" aria-hidden>✅</span>
          <span className="abw-mode-placeholder__label">No results yet</span>
          <span className="abw-mode-placeholder__sub">Click &ldquo;Run all&rdquo; to execute the verification matrix.</span>
        </div>
      )}
    </div>
  );
}
