// apps/web/src/layout/LeftPanel/StatusPill.tsx
// Compact 32px row: agent-status dot · model name · autonomy controls (when running).
// Replaces the separate AgentStatus + ModelSelector sections to reduce the
// fixed-header tax above the chat input from ~96px to ~32px.
import { useEffect, useRef, useState } from 'react';
import { useRunStore, type AgentRunStatus } from '../../lib/store/runStore';

const PROVIDERS = [
  {
    id: 'minimax', label: 'MiniMax',
    models: [
      { id: 'MiniMax-M2.7',           label: 'M2.7' },
      { id: 'MiniMax-M2.7-highspeed', label: 'M2.7 highspeed' },
      { id: 'MiniMax-M2.5',           label: 'M2.5' },
      { id: 'MiniMax-M2.5-highspeed', label: 'M2.5 highspeed' },
    ],
  },
  {
    id: 'ollama', label: 'Ollama (local)',
    models: [
      { id: 'llama3',     label: 'Llama 3 8B'  },
      { id: 'llama3:70b', label: 'Llama 3 70B' },
      { id: 'mistral',    label: 'Mistral 7B'  },
      { id: 'codestral',  label: 'Codestral'   },
    ],
  },
] as const;

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

function dotClass(s: AgentRunStatus): string {
  if (s === 'idle' || s === 'done') return 'abw-status-pill__dot abw-status-pill__dot--idle';
  if (s === 'blocked')               return 'abw-status-pill__dot abw-status-pill__dot--blocked';
  if (s === 'error')                 return 'abw-status-pill__dot abw-status-pill__dot--error';
  return 'abw-status-pill__dot abw-status-pill__dot--running';
}

const isRunning = (s: AgentRunStatus) =>
  ['planning', 'building', 'running', 'inspecting', 'fixing'].includes(s);

export function StatusPill() {
  const {
    activeRun,
    selectedProvider, selectedModel,
    setProvider, setModel,
    pauseRun, resumeRun, stopRun, killRun,
  } = useRunStore();
  const status = activeRun?.status ?? 'idle';

  const [open, setOpen] = useState(false);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const popRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const provider = PROVIDERS.find((p) => p.id === selectedProvider) ?? PROVIDERS[0];
  const models   = provider.models as ReadonlyArray<{ id: string; label: string }>;
  const model    = models.find((m) => m.id === selectedModel) ?? models[0];

  return (
    <div className="abw-status-pill" role="region" aria-label="Agent status and model">
      {/* Status dot + label */}
      <span className={dotClass(status)} aria-hidden />
      <span className="abw-status-pill__status" aria-live="polite">
        {STATUS_LABELS[status]}
      </span>

      <span className="abw-status-pill__sep" aria-hidden>·</span>

      {/* Model picker — click to change */}
      <button
        ref={btnRef}
        type="button"
        className="abw-status-pill__model"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Click to change model"
      >
        <span className="abw-status-pill__model-name">{model?.label ?? 'No model'}</span>
        <span aria-hidden style={{ fontSize: '0.625rem', opacity: 0.6 }}>▾</span>
      </button>

      {/* Autonomy controls — only when a run is active */}
      {activeRun && (
        <span className="abw-status-pill__controls">
          {status === 'blocked' ? (
            <button
              type="button"
              onClick={() => void resumeRun()}
              aria-label="Resume run"
              title="Resume"
              className="abw-status-pill__ctrl"
            >▶</button>
          ) : (
            <button
              type="button"
              onClick={() => void pauseRun()}
              aria-label="Pause run"
              disabled={!isRunning(status)}
              title="Pause"
              className="abw-status-pill__ctrl"
            >⏸</button>
          )}
          <button
            type="button"
            onClick={() => void stopRun()}
            aria-label="Stop run"
            title="Stop cleanly after current step"
            className="abw-status-pill__ctrl"
          >■</button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Emergency kill — immediately terminate the run?')) {
                void killRun();
              }
            }}
            aria-label="Emergency kill"
            title="Kill"
            className="abw-status-pill__ctrl abw-status-pill__ctrl--danger"
          >✕</button>
        </span>
      )}

      {open && (
        <div
          ref={popRef}
          role="menu"
          className="abw-status-pill__popover"
        >
          <div className="abw-status-pill__popover-label">Provider</div>
          <select
            className="abw-select"
            value={provider.id}
            onChange={(e) => {
              const next = PROVIDERS.find((p) => p.id === e.target.value);
              if (!next) return;
              setProvider(next.id);
              const first = next.models[0];
              if (first) setModel(first.id);
            }}
          >
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>

          <div className="abw-status-pill__popover-label" style={{ marginTop: 'var(--space-2)' }}>Model</div>
          <select
            className="abw-select"
            value={model?.id ?? ''}
            onChange={(e) => setModel(e.target.value)}
          >
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>

          <p style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)', marginBottom: 0 }}>
            Applies to the next run. No silent fallback.
          </p>
        </div>
      )}
    </div>
  );
}
