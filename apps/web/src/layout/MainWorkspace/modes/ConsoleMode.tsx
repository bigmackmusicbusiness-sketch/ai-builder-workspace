// apps/web/src/layout/MainWorkspace/modes/ConsoleMode.tsx — runtime log stream.
// Reads from previewStore.logs. Real-time Supabase Realtime stream wired in Step 9.
import { useRef, useEffect } from 'react';
import { usePreviewStore, type LogEntry } from '../../../lib/store/previewStore';

const LEVEL_COLORS: Record<string, string> = {
  info:  '#a0aec0',
  warn:  '#f6ad55',
  error: '#fc8181',
  debug: '#68d391',
};

const LEVEL_PREFIX: Record<string, string> = {
  info:  'INFO ',
  warn:  'WARN ',
  error: 'ERR  ',
  debug: 'DBG  ',
};

export function ConsoleMode() {
  const { logs, clearLogs, session } = usePreviewStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to newest log
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [logs.length]);

  return (
    <div
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        background: '#0d1117', overflow: 'hidden',
      }}
      role="log"
      aria-label="Console output"
      aria-live="polite"
    >
      {/* Console toolbar */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: '0 var(--space-3)', height: 30, flexShrink: 0,
          borderBottom: '1px solid #1a202c', background: '#0f1117',
        }}
      >
        <span style={{ fontSize: '0.6875rem', color: '#4a5568', flex: 1 }}>
          {session ? `Session: ${session.projectSlug} · ${session.status}` : 'No active session'}
        </span>
        <button
          onClick={clearLogs}
          style={{
            border: 'none', background: 'none', cursor: 'pointer',
            color: '#4a5568', fontSize: '0.6875rem',
            padding: '2px var(--space-1)', borderRadius: 3,
          }}
          aria-label="Clear console"
        >
          Clear
        </button>
      </div>

      {/* Log lines */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2) 0' }}
      >
        {logs.length === 0 ? (
          <div
            style={{
              padding: 'var(--space-3)', color: '#4a5568',
              fontSize: '0.8125rem', fontFamily: 'var(--font-mono)',
            }}
          >
            {session ? 'Waiting for output…' : 'No process running — boot a preview to see logs.'}
          </div>
        ) : (
          logs.map((entry, i) => <LogLine key={i} entry={entry} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const ts = new Date(entry.ts).toISOString().slice(11, 23); // HH:MM:SS.mmm
  const color = LEVEL_COLORS[entry.level] ?? '#a0aec0';
  const prefix = LEVEL_PREFIX[entry.level] ?? '     ';

  return (
    <div
      style={{
        display: 'flex', gap: 8, padding: '1px var(--space-3)',
        fontFamily: 'var(--font-mono)', fontSize: '0.75rem', lineHeight: 1.6,
      }}
    >
      <span style={{ color: '#2d3748', flexShrink: 0, userSelect: 'none' }}>{ts}</span>
      <span style={{ color, flexShrink: 0, userSelect: 'none' }}>{prefix}</span>
      <span style={{ color: '#718096', flexShrink: 0, userSelect: 'none' }}>[{entry.source}]</span>
      <span style={{ color, wordBreak: 'break-all' }}>{entry.message}</span>
    </div>
  );
}
