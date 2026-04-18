// apps/web/src/screens/LogsHealthScreen.tsx — runtime logs, request traces, and health checks.
// Reads from runtimeLogs table (via /api/audit + /api/preview/logs).
// Webhook inspector + replay lives on a tab here too.
import { useState, useEffect, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogTab   = 'logs' | 'requests' | 'webhooks' | 'health';

interface LogEntry {
  id:        string;
  level:     LogLevel;
  source:    string;
  message:   string;
  ts:        string;
  meta?:     Record<string, unknown>;
}

interface RequestTrace {
  id:         string;
  method:     string;
  path:       string;
  status:     number;
  durationMs: number;
  ts:         string;
  body?:      string;
}

interface WebhookPayload {
  id:        string;
  webhookId: string;
  receivedAt: string;
  method:    string;
  headers:   Record<string, string>;
  body:      string;
  replayed:  boolean;
}

interface HealthCheck {
  service:   string;
  ok:        boolean;
  latencyMs: number;
  detail?:   string;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function levelColor(level: LogLevel): string {
  switch (level) {
    case 'error': return 'var(--error-500)';
    case 'warn':  return 'var(--warning-500)';
    case 'debug': return 'var(--text-secondary)';
    default:      return 'var(--text-primary)';
  }
}

function statusColor(status: number): string {
  if (status < 300) return 'var(--success-500)';
  if (status < 400) return 'var(--accent-500)';
  if (status < 500) return 'var(--warning-500)';
  return 'var(--error-500)';
}

function fmtTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
       + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

// ---------------------------------------------------------------------------
// Stub data (replaced by API + Realtime in full wiring)
// ---------------------------------------------------------------------------

const STUB_LOGS: LogEntry[] = [
  { id: 'l1', level: 'info',  source: 'api',     message: 'Server started on :8787',                     ts: new Date().toISOString() },
  { id: 'l2', level: 'info',  source: 'agent',   message: 'Orchestrator: planning phase started',        ts: new Date().toISOString() },
  { id: 'l3', level: 'warn',  source: 'preview', message: 'Preview bundle size exceeds 1MB',             ts: new Date().toISOString() },
  { id: 'l4', level: 'error', source: 'db',      message: 'Query timeout after 5000ms',                  ts: new Date().toISOString() },
  { id: 'l5', level: 'debug', source: 'router',  message: 'Route match: GET /api/approvals → approvals', ts: new Date().toISOString() },
];

const STUB_REQUESTS: RequestTrace[] = [
  { id: 'r1', method: 'GET',  path: '/api/health',       status: 200, durationMs: 2,   ts: new Date().toISOString() },
  { id: 'r2', method: 'POST', path: '/api/approvals',    status: 201, durationMs: 45,  ts: new Date().toISOString() },
  { id: 'r3', method: 'GET',  path: '/api/approvals',    status: 200, durationMs: 18,  ts: new Date().toISOString() },
  { id: 'r4', method: 'POST', path: '/api/tests/run',    status: 200, durationMs: 1240, ts: new Date().toISOString() },
  { id: 'r5', method: 'GET',  path: '/api/files',        status: 401, durationMs: 3,   ts: new Date().toISOString() },
];

const STUB_WEBHOOKS: WebhookPayload[] = [
  {
    id: 'w1', webhookId: 'wh-abc', receivedAt: new Date().toISOString(),
    method: 'POST', headers: { 'x-webhook-signature': 'sha256=abc123', 'content-type': 'application/json' },
    body: '{"event":"contact.created","id":"c1"}', replayed: false,
  },
];

const STUB_HEALTH: HealthCheck[] = [
  { service: 'API server',      ok: true,  latencyMs: 3,    checkedAt: new Date().toISOString() },
  { service: 'Supabase DB',     ok: true,  latencyMs: 28,   checkedAt: new Date().toISOString() },
  { service: 'Upstash Redis',   ok: true,  latencyMs: 12,   checkedAt: new Date().toISOString() },
  { service: 'Cloudflare KV',   ok: false, latencyMs: 0,    detail: 'Missing CF_API_TOKEN env var', checkedAt: new Date().toISOString() },
  { service: 'MiniMax provider', ok: false, latencyMs: 0,   detail: 'API key not configured', checkedAt: new Date().toISOString() },
  { service: 'Ollama',          ok: true,  latencyMs: 6,    checkedAt: new Date().toISOString() },
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function LogsHealthScreen() {
  const [tab, setTab]             = useState<LogTab>('logs');
  const [logs, setLogs]           = useState<LogEntry[]>(STUB_LOGS);
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [tailing, setTailing]     = useState(false);
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const tailRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Simulate log tail (real: Supabase Realtime subscription)
  const startTail = useCallback(() => {
    setTailing(true);
    tailRef.current = setInterval(() => {
      const levels: LogLevel[] = ['debug', 'info', 'info', 'info', 'warn', 'error'];
      const sources = ['api', 'agent', 'preview', 'db', 'verify', 'router'];
      const msgs = [
        'Request processed in 12ms',
        'Agent step completed: fs.write',
        'Cache hit for /api/files',
        'Verification adapter: lint passed',
        'Preview bundle rebuilt',
        'DB query returned 0 rows',
      ];
      const newEntry: LogEntry = {
        id:      crypto.randomUUID(),
        level:   levels[Math.floor(Math.random() * levels.length)]!,
        source:  sources[Math.floor(Math.random() * sources.length)]!,
        message: msgs[Math.floor(Math.random() * msgs.length)]!,
        ts:      new Date().toISOString(),
      };
      setLogs((prev) => [...prev.slice(-499), newEntry]); // keep max 500
    }, 2500);
  }, []);

  const stopTail = useCallback(() => {
    setTailing(false);
    if (tailRef.current) clearInterval(tailRef.current);
  }, []);

  useEffect(() => () => { if (tailRef.current) clearInterval(tailRef.current); }, []);

  // Auto-scroll when tailing
  useEffect(() => {
    if (tailing) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, tailing]);

  const visibleLogs = levelFilter === 'all' ? logs : logs.filter((l) => l.level === levelFilter);

  function replayWebhook(id: string) {
    setReplayingId(id);
    // POST to /api/webhooks/:webhookId/replay
    fetch('/api/webhooks/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payloadId: id }) })
      .catch(() => {/* graceful — API not running */})
      .finally(() => setTimeout(() => setReplayingId(null), 1200));
  }

  return (
    <div className="abw-screen">
      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Logs &amp; Health</h1>
          <p className="abw-screen__sub">Runtime logs, request traces, webhook inspector, and service health checks.</p>
        </div>
        {tab === 'logs' && (
          <button
            className={`abw-btn ${tailing ? 'abw-btn--ghost' : 'abw-btn--primary'} abw-btn--sm`}
            onClick={() => tailing ? stopTail() : startTail()}
            aria-pressed={tailing}
          >
            {tailing ? '⏹ Stop tail' : '▶ Tail logs'}
          </button>
        )}
        {tab === 'health' && (
          <button className="abw-btn abw-btn--ghost abw-btn--sm" onClick={() => {}}>↺ Refresh</button>
        )}
      </div>

      {/* Tabs */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Log views">
        {([['logs', 'Logs'], ['requests', 'Requests'], ['webhooks', 'Webhooks'], ['health', 'Health']] as [LogTab, string][]).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`abw-screen__tab${tab === id ? ' abw-screen__tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Logs tab ─────────────────────────────────────────────────── */}
      {tab === 'logs' && (
        <>
          {/* Level filter */}
          <div className="abw-logs__filter-bar">
            {(['all', 'debug', 'info', 'warn', 'error'] as const).map((l) => (
              <button
                key={l}
                className={`abw-logs__filter-btn${levelFilter === l ? ' abw-logs__filter-btn--active' : ''}`}
                onClick={() => setLevelFilter(l)}
                aria-pressed={levelFilter === l}
              >
                {l === 'all' ? 'All' : l.charAt(0).toUpperCase() + l.slice(1)}
              </button>
            ))}
            <span className="abw-logs__count">{visibleLogs.length} entries{tailing ? ' · tailing' : ''}</span>
            <button
              className="abw-btn abw-btn--ghost abw-btn--xs"
              onClick={() => setLogs([])}
              aria-label="Clear logs"
            >
              Clear
            </button>
          </div>

          {/* Log stream */}
          <div className="abw-logs__stream" role="log" aria-live="polite" aria-label="Log stream">
            {visibleLogs.length === 0 ? (
              <div className="abw-logs__empty">No log entries{levelFilter !== 'all' ? ` at ${levelFilter} level` : ''}.</div>
            ) : (
              visibleLogs.map((entry) => (
                <div key={entry.id} className={`abw-logs__entry abw-logs__entry--${entry.level}`}>
                  <span className="abw-logs__ts">{fmtTs(entry.ts)}</span>
                  <span className="abw-logs__level" style={{ color: levelColor(entry.level) }}>
                    {entry.level.toUpperCase()}
                  </span>
                  <span className="abw-logs__source">{entry.source}</span>
                  <span className="abw-logs__message">{entry.message}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </>
      )}

      {/* ── Requests tab ─────────────────────────────────────────────── */}
      {tab === 'requests' && (
        STUB_REQUESTS.length === 0 ? (
          <div className="abw-empty-state">
            <span className="abw-empty-state__icon" aria-hidden>↩</span>
            <p className="abw-empty-state__label">No request traces yet</p>
            <p className="abw-empty-state__sub">Request traces appear here when the API server is running.</p>
          </div>
        ) : (
          <div className="abw-table-wrap">
            <table className="abw-table" aria-label="Request traces">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Method</th>
                  <th>Path</th>
                  <th style={{ width: 80 }}>Status</th>
                  <th style={{ width: 100 }}>Duration</th>
                  <th style={{ width: 120 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {STUB_REQUESTS.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', fontWeight: 700 }}>
                        {r.method}
                      </span>
                    </td>
                    <td>
                      <code style={{ fontSize: '0.8125rem' }}>{r.path}</code>
                    </td>
                    <td>
                      <span style={{ color: statusColor(r.status), fontWeight: 700, fontSize: '0.8125rem' }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                      {r.durationMs}ms
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {fmtTs(r.ts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Webhooks tab ─────────────────────────────────────────────── */}
      {tab === 'webhooks' && (
        STUB_WEBHOOKS.length === 0 ? (
          <div className="abw-empty-state">
            <span className="abw-empty-state__icon" aria-hidden>🪝</span>
            <p className="abw-empty-state__label">No webhook payloads yet</p>
            <p className="abw-empty-state__sub">Inbound payloads appear here. Configure your webhook URL in the Jobs screen.</p>
          </div>
        ) : (
          <div className="abw-logs__webhook-list">
            {STUB_WEBHOOKS.map((wh) => (
              <div key={wh.id} className="abw-logs__webhook-card">
                <div className="abw-logs__webhook-header">
                  <div>
                    <span className="abw-logs__webhook-method">{wh.method}</span>
                    <span className="abw-logs__webhook-id">{wh.id}</span>
                    <span className="abw-logs__webhook-ts">{fmtTs(wh.receivedAt)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button
                      className="abw-btn abw-btn--ghost abw-btn--sm"
                      onClick={() => setExpandedWebhook(expandedWebhook === wh.id ? null : wh.id)}
                      aria-expanded={expandedWebhook === wh.id}
                    >
                      {expandedWebhook === wh.id ? 'Collapse' : 'Inspect'}
                    </button>
                    <button
                      className="abw-btn abw-btn--ghost abw-btn--sm"
                      onClick={() => replayWebhook(wh.id)}
                      disabled={replayingId === wh.id}
                      aria-busy={replayingId === wh.id}
                    >
                      {replayingId === wh.id ? 'Replaying…' : '↺ Replay'}
                    </button>
                  </div>
                </div>

                {expandedWebhook === wh.id && (
                  <div className="abw-logs__webhook-detail">
                    <div className="abw-logs__webhook-section-label">Headers</div>
                    <div className="abw-logs__webhook-kv">
                      {Object.entries(wh.headers).map(([k, v]) => (
                        <div key={k} className="abw-logs__webhook-kv-row">
                          <span className="abw-logs__webhook-kv-key">{k}</span>
                          <span className="abw-logs__webhook-kv-val">{v}</span>
                        </div>
                      ))}
                    </div>
                    <div className="abw-logs__webhook-section-label" style={{ marginTop: 'var(--space-2)' }}>Body</div>
                    <pre className="abw-logs__webhook-body">{(() => { try { return JSON.stringify(JSON.parse(wh.body), null, 2); } catch { return wh.body; } })()}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Health tab ───────────────────────────────────────────────── */}
      {tab === 'health' && (
        <div className="abw-logs__health-grid">
          {STUB_HEALTH.map((h) => (
            <div key={h.service} className={`abw-logs__health-card${h.ok ? '' : ' abw-logs__health-card--error'}`}>
              <div className="abw-logs__health-indicator" aria-hidden>
                {h.ok ? '✓' : '✗'}
              </div>
              <div className="abw-logs__health-body">
                <div className="abw-logs__health-service">{h.service}</div>
                <div className="abw-logs__health-meta">
                  {h.ok ? `${h.latencyMs}ms` : h.detail ?? 'Unreachable'}
                </div>
              </div>
              <div className="abw-logs__health-ts">{fmtTs(h.checkedAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
