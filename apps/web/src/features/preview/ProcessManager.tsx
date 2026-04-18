// apps/web/src/features/preview/ProcessManager.tsx — process status row.
// Shows each running process (dev server, backend, worker) with start/stop controls.
import type { ProcessInfo, SessionStatus } from '../../lib/store/previewStore';

const STATUS_COLORS: Record<string, string> = {
  running: 'var(--color-success)',
  stopped: 'var(--neutral-400)',
  error:   'var(--color-error)',
};

interface ProcessManagerProps {
  sessionStatus: SessionStatus;
  processes: ProcessInfo[];
  onBoot: () => void;
  onStop: () => void;
}

export function ProcessManager({ sessionStatus, processes, onBoot, onStop }: ProcessManagerProps) {
  const isBooted = sessionStatus === 'booted';
  const isBusy   = sessionStatus === 'bundling' || sessionStatus === 'syncing' || sessionStatus === 'queued';
  const isIdle   = sessionStatus === 'idle' || sessionStatus === 'stopped';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: '0 var(--space-3)', height: 30, flexShrink: 0,
        borderBottom: '1px solid var(--border-base)', background: 'var(--bg-elevated)',
        overflowX: 'auto',
      }}
      role="toolbar"
      aria-label="Process manager"
    >
      {/* Boot / Stop button */}
      {isIdle || sessionStatus === 'error' ? (
        <button
          onClick={onBoot}
          style={{
            height: 22, padding: '0 var(--space-2)', border: 'none',
            borderRadius: 'var(--radius-field)', background: 'var(--color-success)',
            color: '#fff', cursor: 'pointer', fontSize: '0.6875rem', fontWeight: 600,
            flexShrink: 0,
          }}
          aria-label="Boot preview"
        >
          ▶ Boot
        </button>
      ) : isBooted ? (
        <button
          onClick={onStop}
          style={{
            height: 22, padding: '0 var(--space-2)', border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)', background: 'var(--bg-subtle)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.6875rem',
            flexShrink: 0,
          }}
          aria-label="Stop preview"
        >
          ■ Stop
        </button>
      ) : (
        <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
          {statusLabel(sessionStatus)}
        </span>
      )}

      {/* Divider */}
      <span style={{ color: 'var(--border-base)', userSelect: 'none' }}>|</span>

      {/* Process pills */}
      {processes.length === 0 && (
        <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
          No processes
        </span>
      )}
      {processes.map((p) => (
        <ProcessPill key={p.name} process={p} />
      ))}

      {/* Busy spinner */}
      {isBusy && (
        <span
          style={{
            marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--text-secondary)',
            flexShrink: 0, animation: 'abw-pulse 1.2s ease infinite',
          }}
          role="status"
          aria-live="polite"
        >
          {statusLabel(sessionStatus)}
        </span>
      )}
    </div>
  );
}

function ProcessPill({ process: p }: { process: ProcessInfo }) {
  return (
    <span
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '1px var(--space-2)', border: '1px solid var(--border-base)',
        borderRadius: 'var(--radius-pill)', fontSize: '0.6875rem',
        color: 'var(--text-secondary)', flexShrink: 0, whiteSpace: 'nowrap',
      }}
      title={p.error ?? p.name}
    >
      <span
        style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[p.status] ?? 'var(--neutral-400)', flexShrink: 0 }}
        aria-hidden
      />
      {p.name}
    </span>
  );
}

function statusLabel(status: SessionStatus): string {
  const map: Record<SessionStatus, string> = {
    idle:     'Idle',
    queued:   'Queued…',
    bundling: 'Bundling…',
    syncing:  'Syncing to edge…',
    booted:   'Running',
    error:    'Error',
    stopped:  'Stopped',
  };
  return map[status] ?? status;
}
