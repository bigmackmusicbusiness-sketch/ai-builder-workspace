// apps/web/src/layout/MainWorkspace/modes/PreviewMode.tsx — preview iframe mode.
// Shows the Cloudflare Worker-served project preview. Manages boot/stop/reload.
// Console overlay streams logs from previewStore.
import { useRef, useCallback } from 'react';
import { usePreviewStore } from '../../../lib/store/previewStore';
import { ProcessManager } from '../../../features/preview/ProcessManager';

const VIEWPORT_SIZES: { label: string; w: number }[] = [
  { label: '360', w: 360 },
  { label: '768', w: 768 },
  { label: '1024', w: 1024 },
  { label: '1280', w: 1280 },
  { label: '1440', w: 1440 },
  { label: 'Full', w: 0 },
];

const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:8787';

export function PreviewMode() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const {
    session, logs, viewportWidth, currentRoute,
    setSession, updateSession, appendLogs, setViewportWidth, setCurrentRoute,
  } = usePreviewStore();

  const sessionStatus = session?.status ?? 'idle';

  // ── Boot ───────────────────────────────────────────────────────────────────
  const handleBoot = useCallback(async () => {
    // Stub: in Step 9 this will use the real project context.
    // For now, boot with a placeholder project.
    const body = {
      projectId:   '00000000-0000-0000-0000-000000000001',
      projectSlug: 'my-project',
      rootDir:     '/tmp/preview-stub',
      entryPoint:  'src/main.tsx',
      framework:   'react-vite',
    };

    try {
      setSession({
        sessionId: 'pending',
        projectSlug: 'my-project',
        previewUrl: '',
        status: 'queued',
        processes: [],
      });

      const res = await fetch(`${API_URL}/api/preview/boot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        updateSession({ status: 'error', error: err.error ?? 'Boot failed' });
        return;
      }

      const data = await res.json() as { sessionId: string; previewUrl: string };
      setSession({
        sessionId: data.sessionId,
        projectSlug: 'my-project',
        previewUrl: data.previewUrl,
        status: 'bundling',
        processes: [{ name: 'dev-server', status: 'running', startedAt: Date.now() }],
      });

      // Poll status + logs until booted or error
      void pollSession(data.sessionId);
    } catch (err) {
      updateSession({ status: 'error', error: String(err) });
    }
  }, [setSession, updateSession]);

  // Poll the session status every 2s until terminal state
  const pollSession = useCallback(async (sessionId: string) => {
    let attempts = 0;
    while (attempts < 60) {
      await sleep(2000);
      attempts++;
      try {
        const res = await fetch(`${API_URL}/api/preview/logs?sessionId=${sessionId}`);
        if (!res.ok) break;
        const data = await res.json() as { logs: typeof logs; sessionStatus: string };
        if (data.logs.length > 0) appendLogs(data.logs);
        updateSession({ status: data.sessionStatus as typeof sessionStatus });
        if (data.sessionStatus === 'booted' || data.sessionStatus === 'error' || data.sessionStatus === 'stopped') break;
      } catch {
        break;
      }
    }
  }, [appendLogs, updateSession]);

  // ── Stop ───────────────────────────────────────────────────────────────────
  const handleStop = useCallback(async () => {
    if (!session?.sessionId) return;
    try {
      await fetch(`${API_URL}/api/preview/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      updateSession({ status: 'stopped' });
    } catch {
      updateSession({ status: 'stopped' });
    }
  }, [session, updateSession]);

  // ── Reload ─────────────────────────────────────────────────────────────────
  const handleReload = useCallback(() => {
    if (iframeRef.current) {
      // eslint-disable-next-line no-self-assign
      iframeRef.current.src = iframeRef.current.src;
    }
  }, []);

  const previewSrc = session?.status === 'booted' && session.previewUrl
    ? `${session.previewUrl}${currentRoute}`
    : null;

  const frameWidth = viewportWidth === 0 ? '100%' : `${viewportWidth}px`;

  return (
    <div className="abw-preview">
      {/* Process manager row */}
      <ProcessManager
        sessionStatus={sessionStatus}
        processes={session?.processes ?? []}
        onBoot={handleBoot}
        onStop={handleStop}
      />

      {/* Toolbar: reload, URL bar, viewport picker, screenshot */}
      <div className="abw-preview__toolbar">
        <button
          className="abw-preview__toolbar-btn"
          onClick={handleReload}
          disabled={!previewSrc}
          aria-label="Reload preview"
          title="Reload"
          style={{
            height: 26, padding: '0 var(--space-2)', border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)', background: 'var(--bg-subtle)',
            cursor: previewSrc ? 'pointer' : 'default', fontSize: '0.875rem',
            color: 'var(--text-secondary)', opacity: previewSrc ? 1 : 0.4,
          }}
        >
          ↺
        </button>

        <input
          className="abw-preview__url-bar"
          value={previewSrc ? `${session!.previewUrl}${currentRoute}` : '—'}
          onChange={(e) => {
            try {
              const u = new URL(e.target.value);
              setCurrentRoute(u.pathname + u.search + u.hash);
            } catch { /* invalid URL */ }
          }}
          aria-label="Preview URL"
          readOnly={!previewSrc}
        />

        <div style={{ display: 'flex', gap: 2 }} role="group" aria-label="Viewport size">
          {VIEWPORT_SIZES.map(({ label, w }) => {
            const active = viewportWidth === w;
            return (
              <button
                key={label}
                onClick={() => setViewportWidth(w)}
                aria-pressed={active}
                style={{
                  height: 26, padding: '0 var(--space-2)',
                  border: `1px solid ${active ? 'var(--accent-500)' : 'var(--border-base)'}`,
                  borderRadius: 'var(--radius-field)',
                  background: active ? 'var(--accent-50)' : 'var(--bg-subtle)',
                  cursor: 'pointer', fontSize: '0.6875rem',
                  color: active ? 'var(--accent-600)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                }}
                aria-label={w === 0 ? 'Full width' : `${w}px viewport`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <button
          style={{
            height: 26, padding: '0 var(--space-2)', border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)', background: 'var(--bg-subtle)',
            cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-secondary)',
          }}
          aria-label="Take screenshot"
          title="Screenshot"
          disabled={!previewSrc}
        >
          📷
        </button>
      </div>

      {/* Frame area */}
      <div className="abw-preview__frame-wrap">
        {previewSrc ? (
          <iframe
            ref={iframeRef}
            src={previewSrc}
            title="Project preview"
            style={{
              width: frameWidth,
              height: '100%',
              border: 'none',
              borderRadius: viewportWidth > 0 ? 'var(--radius-card)' : 0,
              boxShadow: viewportWidth > 0 ? 'var(--shadow-overlay)' : 'none',
              background: 'white',
              flexShrink: 0,
              transition: 'width var(--duration-base) var(--ease-standard)',
            }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <EmptyState status={sessionStatus} error={session?.error} onBoot={handleBoot} />
        )}
      </div>
    </div>
  );
}

// ── Empty / error states ─────────────────────────────────────────────────────

function EmptyState({
  status, error, onBoot,
}: { status: string; error?: string; onBoot: () => void }) {
  if (status === 'bundling' || status === 'syncing' || status === 'queued') {
    return (
      <div className="abw-mode-placeholder" style={{ height: '100%' }}>
        <span
          className="abw-mode-placeholder__icon"
          aria-hidden
          style={{ animation: 'abw-pulse 1.2s ease infinite' }}
        >
          ⚡
        </span>
        <span className="abw-mode-placeholder__label">
          {status === 'bundling' ? 'Bundling…' : status === 'syncing' ? 'Syncing to edge…' : 'Queued…'}
        </span>
        <span className="abw-mode-placeholder__sub">Check the Console tab for details.</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="abw-mode-placeholder" style={{ height: '100%' }}>
        <span className="abw-mode-placeholder__icon" aria-hidden>⚠️</span>
        <span className="abw-mode-placeholder__label" style={{ color: 'var(--color-error)' }}>
          Preview error
        </span>
        <span className="abw-mode-placeholder__sub" style={{ color: 'var(--color-error)', maxWidth: 400, textAlign: 'center' }}>
          {error ?? 'An error occurred during bundling.'}
        </span>
        <button
          onClick={onBoot}
          style={{
            marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-4)',
            background: 'var(--accent-500)', color: '#fff', border: 'none',
            borderRadius: 'var(--radius-button)', cursor: 'pointer',
            fontWeight: 600, fontSize: '0.875rem',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Idle / stopped
  return (
    <div className="abw-mode-placeholder" style={{ height: '100%' }}>
      <span className="abw-mode-placeholder__icon" aria-hidden>🖥</span>
      <span className="abw-mode-placeholder__label">No preview running</span>
      <span className="abw-mode-placeholder__sub">Boot a project to see the live preview here.</span>
      <button
        onClick={onBoot}
        style={{
          marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-4)',
          background: 'var(--accent-500)', color: '#fff', border: 'none',
          borderRadius: 'var(--radius-button)', cursor: 'pointer',
          fontWeight: 600, fontSize: '0.875rem',
        }}
      >
        Boot preview
      </button>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
