// apps/web/src/screens/AgentRunsScreen.tsx — agent run history + step drill-down.
// Shows all runs with status, model, duration, step count, goal summary.
// Click a row to see the full step list. Empty state until real API is wired.
import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type RunStatus  = 'running' | 'completed' | 'failed' | 'paused' | 'stopped';
type StepStatus = 'running' | 'completed' | 'failed' | 'skipped';
type StepRole   = 'planner' | 'builder' | 'runtime' | 'visual' | 'backend' | 'fixer' | 'release';

interface AgentStep {
  id:         string;
  role:       StepRole;
  tool:       string;
  status:     StepStatus;
  durationMs: number | null;
  summary:    string;
  costUsd?:   number;
}

interface AgentRun {
  id:          string;
  goal:        string;
  model:       string;
  provider:    string;
  status:      RunStatus;
  steps:       AgentStep[];
  startedAt:   string;
  endedAt:     string | null;
  costUsd?:    number;
  summary?:    string;
}

type StatusFilter = 'all' | RunStatus;

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  if (m < 2)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function duration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s  = Math.floor(ms / 1000);
  if (s  < 60)  return `${s}s`;
  const m  = Math.floor(s / 60);
  if (m  < 60)  return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function runStatusStyle(s: RunStatus): { color: string; label: string } {
  switch (s) {
    case 'running':   return { color: 'var(--color-accent)', label: 'Running'   };
    case 'completed': return { color: 'var(--success-500)', label: 'Completed' };
    case 'failed':    return { color: 'var(--error-500)',   label: 'Failed'    };
    case 'paused':    return { color: 'var(--warning-500)', label: 'Paused'    };
    case 'stopped':   return { color: 'var(--text-secondary)', label: 'Stopped' };
  }
}

function stepStatusStyle(s: StepStatus): { color: string; label: string } {
  switch (s) {
    case 'running':   return { color: 'var(--color-accent)', label: 'Running'   };
    case 'completed': return { color: 'var(--success-500)', label: '✓'         };
    case 'failed':    return { color: 'var(--error-500)',   label: '✕'         };
    case 'skipped':   return { color: 'var(--text-secondary)', label: '—'      };
  }
}

const ROLE_LABELS: Record<StepRole, string> = {
  planner: 'Planner', builder: 'Builder', runtime: 'Runtime',
  visual: 'Visual', backend: 'Backend', fixer: 'Fixer', release: 'Release',
};

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all',       label: 'All'       },
  { id: 'running',   label: 'Running'   },
  { id: 'completed', label: 'Completed' },
  { id: 'failed',    label: 'Failed'    },
  { id: 'paused',    label: 'Paused'    },
  { id: 'stopped',   label: 'Stopped'   },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentRunsScreen() {
  const [runs]           = useState<AgentRun[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<AgentRun | null>(null);

  const filtered = runs.filter((r) => filter === 'all' || r.status === filter);

  return (
    <div className="abw-screen">
      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Agent Runs</h1>
          <p className="abw-screen__sub">
            {runs.length === 0
              ? 'No runs yet — start a run from the workspace.'
              : `${runs.length} run${runs.length !== 1 ? 's' : ''} · ${runs.filter((r) => r.status === 'completed').length} completed`}
          </p>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Filter by status">
        {STATUS_FILTERS.map(({ id, label }) => {
          const count = id === 'all' ? runs.length : runs.filter((r) => r.status === id).length;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={filter === id}
              className={`abw-screen__tab${filter === id ? ' abw-screen__tab--active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}{count > 0 && id !== 'all' && (
                <span style={{ marginLeft: 4, opacity: 0.7 }}>({count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {runs.length === 0 ? (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>🤖</span>
          <p className="abw-empty-state__label">No runs yet</p>
          <p className="abw-empty-state__sub">
            Start a run from the workspace chat. Each run records every step, model call, and verification result.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>🔍</span>
          <p className="abw-empty-state__label">No {filter} runs</p>
          <p className="abw-empty-state__sub">Change the filter to see other runs.</p>
        </div>
      ) : (
        <div className="abw-runs__layout">
          {/* Run list */}
          <div className={`abw-runs__list${selected ? ' abw-runs__list--narrow' : ''}`}>
            <div className="abw-table-wrap">
              <table className="abw-table" aria-label="Agent runs">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Status</th>
                    <th>Goal</th>
                    <th style={{ width: 140 }}>Model</th>
                    <th style={{ width: 60 }}>Steps</th>
                    <th style={{ width: 80 }}>Duration</th>
                    <th style={{ width: 90 }}>Started</th>
                    <th style={{ width: 70 }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((run) => {
                    const { color, label } = runStatusStyle(run.status);
                    const isSelected = selected?.id === run.id;
                    return (
                      <tr
                        key={run.id}
                        style={{ cursor: 'pointer', background: isSelected ? 'var(--bg-subtle)' : undefined }}
                        onClick={() => setSelected(isSelected ? null : run)}
                        aria-selected={isSelected}
                      >
                        <td>
                          <span style={{ color, fontWeight: 600, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {run.status === 'running' && (
                              <span className="abw-agent-status__dot abw-agent-status__dot--running" aria-hidden />
                            )}
                            {label}
                          </span>
                        </td>
                        <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span className="abw-table__name" title={run.goal}>{run.goal}</span>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          <code style={{ fontSize: '0.6875rem', background: 'var(--surface-elevated)', padding: '1px 4px', borderRadius: 3 }}>
                            {run.provider}/{run.model}
                          </code>
                        </td>
                        <td style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {run.steps.length}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {duration(run.startedAt, run.endedAt)}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {relativeTime(run.startedAt)}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {run.costUsd != null ? `$${run.costUsd.toFixed(4)}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Step detail panel */}
          {selected && (
            <div className="abw-runs__detail">
              <div className="abw-runs__detail-header">
                <div>
                  <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', margin: 0 }}>{selected.goal}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 'var(--space-1) 0 0' }}>
                    {selected.steps.length} step{selected.steps.length !== 1 ? 's' : ''} ·{' '}
                    {duration(selected.startedAt, selected.endedAt)} ·{' '}
                    {selected.costUsd != null ? `$${selected.costUsd.toFixed(4)}` : 'cost unknown'}
                  </p>
                </div>
                <button
                  className="abw-btn abw-btn--ghost abw-btn--xs"
                  onClick={() => setSelected(null)}
                  aria-label="Close detail"
                >✕</button>
              </div>

              {selected.summary && (
                <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  {selected.summary}
                </div>
              )}

              <div style={{ overflowY: 'auto', flex: 1 }}>
                {selected.steps.length === 0 ? (
                  <div className="abw-empty-state" style={{ padding: 'var(--space-6)' }}>
                    <p className="abw-empty-state__label" style={{ fontSize: '0.8125rem' }}>No steps recorded</p>
                  </div>
                ) : (
                  selected.steps.map((step, idx) => {
                    const { color, label } = stepStatusStyle(step.status);
                    return (
                      <div
                        key={step.id}
                        style={{
                          padding: 'var(--space-3)',
                          borderBottom: '1px solid var(--border-subtle)',
                          display: 'grid',
                          gridTemplateColumns: '20px 80px 1fr auto',
                          gap: 'var(--space-2)',
                          alignItems: 'flex-start',
                          fontSize: '0.75rem',
                        }}
                      >
                        <span style={{ color: 'var(--text-tertiary)', paddingTop: 1 }}>{idx + 1}</span>
                        <div>
                          <span className="abw-badge" style={{ fontSize: '0.5625rem', marginBottom: 2, display: 'inline-block' }}>
                            {ROLE_LABELS[step.role]}
                          </span>
                          <p style={{ margin: 0, color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.6875rem' }}>
                            {step.tool}
                          </p>
                        </div>
                        <p style={{ margin: 0, color: 'var(--text-primary)', lineHeight: 1.4 }}>{step.summary}</p>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ color, fontWeight: 600 }}>{label}</span>
                          {step.durationMs != null && (
                            <p style={{ margin: '2px 0 0', color: 'var(--text-tertiary)', fontSize: '0.625rem' }}>
                              {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
