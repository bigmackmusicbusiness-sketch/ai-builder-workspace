// apps/web/src/features/api-tester/ApiTester.tsx — request builder + response panel.
// Lets developers call project API endpoints via the preview URL.
// No auth secrets stored in browser; headers are plaintext only.
import { useState, useRef } from 'react';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Header { key: string; value: string; enabled: boolean }

interface ApiResponse {
  status:     number;
  statusText: string;
  headers:    Record<string, string>;
  body:       string;
  durationMs: number;
  size:       number;
}

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET:    'var(--success-500)',
  POST:   'var(--accent-500)',
  PUT:    'var(--warning-500)',
  PATCH:  'var(--warning-500)',
  DELETE: 'var(--error-500)',
};

function statusColor(status: number): string {
  if (status < 300) return 'var(--success-500)';
  if (status < 400) return 'var(--accent-500)';
  if (status < 500) return 'var(--warning-500)';
  return 'var(--error-500)';
}

function formatJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApiTester({ previewUrl = 'http://localhost:3000' }: { previewUrl?: string }) {
  const [method, setMethod]     = useState<HttpMethod>('GET');
  const [url, setUrl]           = useState(`${previewUrl}/api/health`);
  const [headers, setHeaders]   = useState<Header[]>([
    { key: 'Content-Type', value: 'application/json', enabled: true },
  ]);
  const [body, setBody]         = useState('');
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [activeResTab, setActiveResTab] = useState<'body' | 'headers'>('body');
  const abortRef = useRef<AbortController | null>(null);

  async function sendRequest() {
    if (loading) {
      abortRef.current?.abort();
      return;
    }
    setLoading(true);
    setError(null);
    setResponse(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = Date.now();

    try {
      const reqHeaders: Record<string, string> = {};
      for (const h of headers) {
        if (h.enabled && h.key.trim()) reqHeaders[h.key.trim()] = h.value;
      }

      const res = await fetch(url, {
        method,
        headers: reqHeaders,
        body:    method !== 'GET' && method !== 'DELETE' && body.trim() ? body : undefined,
        signal:  ctrl.signal,
      });

      const text = await res.text();
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });

      setResponse({
        status:     res.status,
        statusText: res.statusText,
        headers:    resHeaders,
        body:       text,
        durationMs: Date.now() - t0,
        size:       new TextEncoder().encode(text).length,
      });
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'AbortError') {
        setError('Request cancelled.');
      } else {
        setError(err instanceof Error ? err.message : 'Network error — is the server running?');
      }
    } finally {
      setLoading(false);
    }
  }

  function addHeader() {
    setHeaders((prev) => [...prev, { key: '', value: '', enabled: true }]);
  }

  function updateHeader(idx: number, patch: Partial<Header>) {
    setHeaders((prev) => prev.map((h, i) => i === idx ? { ...h, ...patch } : h));
  }

  function removeHeader(idx: number) {
    setHeaders((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="abw-api-tester">
      {/* Request bar */}
      <div className="abw-api-tester__bar">
        <select
          className="abw-api-tester__method"
          value={method}
          onChange={(e) => setMethod(e.target.value as HttpMethod)}
          style={{ color: METHOD_COLORS[method] }}
          aria-label="HTTP method"
        >
          {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map((m) => (
            <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>{m}</option>
          ))}
        </select>

        <input
          className="abw-api-tester__url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void sendRequest()}
          placeholder="http://localhost:3000/api/..."
          aria-label="Request URL"
          spellCheck={false}
        />

        <button
          className={`abw-btn ${loading ? 'abw-btn--ghost' : 'abw-btn--primary'} abw-btn--sm`}
          onClick={() => void sendRequest()}
          aria-busy={loading}
          aria-label={loading ? 'Cancel request' : 'Send request'}
        >
          {loading ? '✕ Cancel' : 'Send'}
        </button>
      </div>

      <div className="abw-api-tester__body">
        {/* Request side */}
        <div className="abw-api-tester__request">
          {/* Headers */}
          <div className="abw-api-tester__section-label">
            Headers
            <button className="abw-btn abw-btn--ghost abw-btn--xs" onClick={addHeader} aria-label="Add header">+ Add</button>
          </div>
          <div className="abw-api-tester__headers">
            {headers.map((h, i) => (
              <div key={i} className="abw-api-tester__header-row">
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={(e) => updateHeader(i, { enabled: e.target.checked })}
                  aria-label={`Enable header ${h.key || i}`}
                  className="abw-api-tester__header-check"
                />
                <input
                  className="abw-api-tester__header-key"
                  type="text"
                  value={h.key}
                  onChange={(e) => updateHeader(i, { key: e.target.value })}
                  placeholder="Key"
                  aria-label="Header key"
                  spellCheck={false}
                />
                <input
                  className="abw-api-tester__header-val"
                  type="text"
                  value={h.value}
                  onChange={(e) => updateHeader(i, { value: e.target.value })}
                  placeholder="Value"
                  aria-label="Header value"
                  spellCheck={false}
                />
                <button
                  className="abw-api-tester__header-del"
                  onClick={() => removeHeader(i)}
                  aria-label={`Remove header ${h.key || i}`}
                >✕</button>
              </div>
            ))}
          </div>

          {/* Body */}
          {method !== 'GET' && method !== 'DELETE' && (
            <>
              <div className="abw-api-tester__section-label">Body (JSON)</div>
              <textarea
                className="abw-api-tester__body-input"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder='{ "key": "value" }'
                aria-label="Request body"
                spellCheck={false}
                rows={6}
              />
            </>
          )}
        </div>

        {/* Response side */}
        <div className="abw-api-tester__response">
          {!response && !error && !loading && (
            <div className="abw-api-tester__response-empty">
              <span aria-hidden style={{ fontSize: '1.5rem', opacity: 0.3 }}>↩</span>
              <p>Send a request to see the response.</p>
            </div>
          )}

          {loading && (
            <div className="abw-api-tester__response-empty">
              <p style={{ color: 'var(--text-secondary)' }}>Waiting for response…</p>
            </div>
          )}

          {error && (
            <div className="abw-banner abw-banner--error" role="alert" style={{ margin: 'var(--space-4)' }}>
              {error}
            </div>
          )}

          {response && (
            <>
              {/* Status bar */}
              <div className="abw-api-tester__res-status-bar">
                <span
                  className="abw-api-tester__res-status"
                  style={{ color: statusColor(response.status) }}
                  aria-label={`HTTP status ${response.status}`}
                >
                  {response.status} {response.statusText}
                </span>
                <span className="abw-api-tester__res-meta">
                  {response.durationMs}ms · {humanSize(response.size)}
                </span>
              </div>

              {/* Response tabs */}
              <div className="abw-api-tester__res-tabs">
                {(['body', 'headers'] as const).map((t) => (
                  <button
                    key={t}
                    className={`abw-api-tester__res-tab${activeResTab === t ? ' abw-api-tester__res-tab--active' : ''}`}
                    onClick={() => setActiveResTab(t)}
                    aria-pressed={activeResTab === t}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {activeResTab === 'body' && (
                <pre className="abw-api-tester__res-body">{formatJson(response.body)}</pre>
              )}

              {activeResTab === 'headers' && (
                <div className="abw-api-tester__res-headers">
                  {Object.entries(response.headers).map(([k, v]) => (
                    <div key={k} className="abw-api-tester__res-header-row">
                      <span className="abw-api-tester__res-header-key">{k}</span>
                      <span className="abw-api-tester__res-header-val">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
