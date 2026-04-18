// apps/web/src/layout/LeftPanel/AgentStatus.tsx — agent status indicator + autonomy controls.
// Shows current step text, animated dot for running states, and Pause/Resume/Stop/Kill buttons.
// Respects prefers-reduced-motion for the pulse animation.
import { useRunStore, type AgentRunStatus } from '../../lib/store/runStore';

interface AgentStatusProps {
  status:       AgentRunStatus;
  currentStep?: string;
}

const STATUS_LABELS: Record<AgentRunStatus, string> = {
  idle:       'Idle',
  planning:   'Planning…',
  building:   'Building…',
  running:    'Running…',
  inspecting: 'Inspecting…',
  fixing:     'Fixing…',
  blocked:    'Paused',
  error:      'Error',
  done:       'Done',
};

const DOT_CLASS: Record<AgentRunStatus, string> = {
  idle:       'abw-agent-status__dot abw-agent-status__dot--idle',
  planning:   'abw-agent-status__dot abw-agent-status__dot--running',
  building:   'abw-agent-status__dot abw-agent-status__dot--running',
  running:    'abw-agent-status__dot abw-agent-status__dot--running',
  inspecting: 'abw-agent-status__dot abw-agent-status__dot--running',
  fixing:     'abw-agent-status__dot abw-agent-status__dot--running',
  blocked:    'abw-agent-status__dot abw-agent-status__dot--blocked',
  error:      'abw-agent-status__dot abw-agent-status__dot--error',
  done:       'abw-agent-status__dot abw-agent-status__dot--idle',
};

const isRunning = (s: AgentRunStatus) =>
  ['planning', 'building', 'running', 'inspecting', 'fixing'].includes(s);

export function AgentStatus({ status, currentStep }: AgentStatusProps) {
  const { pauseRun, resumeRun, stopRun, killRun, activeRun } = useRunStore();
  const hasRun = !!activeRun;

  return (
    <div style={{ borderTop: '1px solid var(--border-base)', background: 'var(--bg-elevated)' }}>
      {/* Status row */}
      <div className="abw-agent-status" aria-live="polite" aria-atomic>
        <span className={DOT_CLASS[status]} aria-hidden />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {STATUS_LABELS[status]}
          {currentStep && isRunning(status) && (
            <span style={{ color: 'var(--text-secondary)', marginLeft: 'var(--space-1)', fontSize: '0.6875rem' }}>
              — {currentStep}
            </span>
          )}
        </span>
      </div>

      {/* Autonomy controls — only when a run is active */}
      {hasRun && (
        <div style={{ display: 'flex', gap: 'var(--space-1)', padding: 'var(--space-1) var(--space-3) var(--space-2)' }}>
          {status === 'blocked' ? (
            <button
              className="abw-btn abw-btn--ghost abw-btn--sm"
              style={{ flex: 1 }}
              onClick={() => void resumeRun()}
              aria-label="Resume run"
            >
              ▶ Resume
            </button>
          ) : (
            <button
              className="abw-btn abw-btn--ghost abw-btn--sm"
              style={{ flex: 1 }}
              onClick={() => void pauseRun()}
              disabled={!isRunning(status)}
              aria-label="Pause run"
            >
              ⏸ Pause
            </button>
          )}
          <button
            className="abw-btn abw-btn--ghost abw-btn--sm"
            onClick={() => void stopRun()}
            aria-label="Stop run"
            title="Stop cleanly after current step"
          >
            ■ Stop
          </button>
          <button
            className="abw-btn abw-btn--ghost abw-btn--sm"
            style={{ color: 'var(--color-error)' }}
            onClick={() => {
              if (window.confirm('Emergency kill — immediately terminate the run?')) {
                void killRun();
              }
            }}
            aria-label="Emergency kill"
            title="Emergency kill — terminates immediately"
          >
            ✕ Kill
          </button>
        </div>
      )}
    </div>
  );
}
