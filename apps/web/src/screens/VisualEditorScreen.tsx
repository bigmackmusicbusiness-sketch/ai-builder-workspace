// apps/web/src/screens/VisualEditorScreen.tsx — Live visual editor.
// Wraps a served HTML file in an iframe with an injected editing runtime.
// Handles postMessage events from the runtime and applies edits via the API.
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { useAuthStore } from '../lib/store/authStore';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

type Viewport = 'mobile' | 'tablet' | 'desktop';

interface EditorSession {
  id:         string;
  filePath:   string;
  targetType: 'website' | 'ebook' | 'email';
  editCount:  number;
}

interface EditMessage {
  abwAction: true;
  action:    string;
  selector:  string;
  payload?:  Record<string, unknown>;
}

const VIEWPORT_WIDTHS: Record<Viewport, string> = {
  mobile:  '375px',
  tablet:  '768px',
  desktop: '100%',
};

export function VisualEditorScreen(): JSX.Element {
  // Parse sessionId from the URL path: /edit/:sessionId
  const sessionId = window.location.pathname.split('/').filter(Boolean).slice(-1)[0] ?? '';

  const [session, setSession]     = useState<EditorSession | null>(null);
  const [viewport, setViewport]   = useState<Viewport>('desktop');
  const [editCount, setEditCount] = useState(0);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [applying, setApplying]   = useState(false);
  const [cacheBust, setCacheBust] = useState(Date.now());

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── Load session info ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    apiFetch<{ session: EditorSession }>(`/api/editor/sessions/${sessionId}`)
      .then((r) => { setSession(r.session); setEditCount(r.session.editCount); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load editor session.'));
  }, [sessionId]);

  // ── postMessage handler ─────────────────────────────────────────────────────
  useEffect(() => {
    async function handleMessage(e: MessageEvent) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = e.data as any;
      if (!data?.abwAction) return;
      const msg = data as EditMessage;

      const token = useAuthStore.getState().session?.access_token;
      if (!token) { setError('Not signed in'); return; }

      setApplying(true);
      setError(null);
      try {
        await fetch(`${API_BASE}/api/editor/apply`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            sessionId,
            abwId:  msg.selector,
            action: { type: msg.action, ...(msg.payload ?? {}) },
          }),
        }).then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
            throw new Error(body.error ?? 'Apply failed');
          }
          return res.json();
        });

        setEditCount((n) => n + 1);
        setLastAction(`Applied ${msg.action.replace(/_/g, ' ')} · ${new Date().toLocaleTimeString()}`);
        // Reload iframe to reflect the file change
        setCacheBust(Date.now());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Edit failed');
      } finally {
        setApplying(false);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sessionId]);

  const serveUrl = `${API_BASE}/api/editor/serve/${sessionId}?t=${cacheBust}`;
  const widthStyle = VIEWPORT_WIDTHS[viewport];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--surface-base)' }}>
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div
        style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '0 var(--space-4)',
          borderBottom: '1px solid var(--border-base)',
          background: 'var(--surface-elevated)',
          flexShrink: 0,
        }}
      >
        {/* Back */}
        <button
          className="abw-btn abw-btn--ghost abw-btn--xs"
          onClick={() => window.history.back()}
          aria-label="Go back"
        >
          ← Back
        </button>

        {/* Session info */}
        {session ? (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.filePath}
          </span>
        ) : (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Loading…</span>
        )}

        {session && (
          <span
            className="abw-badge"
            style={{ fontSize: '0.625rem', flexShrink: 0 }}
          >
            {session.targetType}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {/* Viewport toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border-base)', borderRadius: 'var(--radius-button)', overflow: 'hidden' }}>
            {(['mobile', 'tablet', 'desktop'] as Viewport[]).map((v) => (
              <button
                key={v}
                className={`abw-btn abw-btn--ghost abw-btn--xs${viewport === v ? ' abw-btn--secondary' : ''}`}
                style={{
                  border: 'none',
                  borderRadius: 0,
                  borderRight: v !== 'desktop' ? '1px solid var(--border-base)' : 'none',
                  fontWeight: viewport === v ? 600 : 400,
                }}
                onClick={() => setViewport(v)}
                aria-pressed={viewport === v}
              >
                {v === 'mobile' ? '📱' : v === 'tablet' ? '📟' : '🖥'} {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>

          {/* Edit count */}
          {editCount > 0 && (
            <span
              className="abw-badge"
              style={{ fontSize: '0.625rem', background: 'var(--accent-100)', color: 'var(--accent-600)' }}
            >
              {editCount} edit{editCount !== 1 ? 's' : ''}
            </span>
          )}

          {/* Undo placeholder */}
          <button
            className="abw-btn abw-btn--ghost abw-btn--xs"
            disabled
            title="Undo coming soon — use Versions screen to restore a snapshot"
          >
            ↩ Undo
          </button>

          {/* Applying indicator */}
          {applying && (
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-500)', flexShrink: 0 }}>
              Saving…
            </span>
          )}
        </div>
      </div>

      {/* ── Error banner ──────────────────────────────────────────────── */}
      {error && (
        <div
          className="abw-banner abw-banner--warning"
          style={{ flexShrink: 0 }}
          role="alert"
        >
          ⚠ {error}
          <button
            className="abw-btn abw-btn--ghost abw-btn--xs"
            style={{ marginLeft: 'auto' }}
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── iframe area ────────────────────────────────────────────────── */}
      {!sessionId ? (
        <div className="abw-empty-state" style={{ flex: 1 }}>
          <span className="abw-empty-state__icon" aria-hidden>✏️</span>
          <p className="abw-empty-state__label">No editor session</p>
          <p className="abw-empty-state__sub">Open the editor from a project or eBook page.</p>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            padding: viewport !== 'desktop' ? 'var(--space-5)' : 0,
            background: viewport !== 'desktop' ? 'var(--surface-base)' : 'transparent',
          }}
        >
          <iframe
            ref={iframeRef}
            src={serveUrl}
            title="Visual editor"
            style={{
              width: widthStyle,
              maxWidth: widthStyle,
              height: viewport !== 'desktop' ? '80vh' : '100%',
              border: viewport !== 'desktop' ? '1px solid var(--border-base)' : 'none',
              borderRadius: viewport !== 'desktop' ? 'var(--radius-card)' : 0,
              background: '#fff',
              display: 'block',
              flexShrink: 0,
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      )}

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      <div
        style={{
          height: 28,
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--space-4)',
          borderTop: '1px solid var(--border-base)',
          background: 'var(--surface-elevated)',
          fontSize: '0.6875rem',
          color: 'var(--text-tertiary)',
          flexShrink: 0,
          gap: 'var(--space-3)',
        }}
        role="status"
        aria-live="polite"
      >
        {lastAction
          ? <span style={{ color: 'var(--success-500)' }}>✓ {lastAction}</span>
          : <span>Click any element in the preview to start editing</span>
        }
        <span style={{ marginLeft: 'auto' }}>
          {viewport} · {widthStyle}
        </span>
      </div>
    </div>
  );
}
