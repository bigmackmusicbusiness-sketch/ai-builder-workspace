// apps/web/src/layout/MainWorkspace/modes/PreviewMode.tsx — preview iframe mode.
//
// Phase C "retail vibe" upgrades:
//   * Auto-reboot when the active project changes (stops the previous, boots the new).
//   * SSE listener at /api/preview/watch/:slug — server emits `file-changed` whenever
//     the agent (or any code) writes to the workspace. Debounced 250ms → re-bundle
//     via /api/preview/rebundle and reload the iframe with a cache-buster.
//   * Project-isolation guard: empty state when no project is selected.
//   * Screenshot button POSTs /api/preview/screenshot (Playwright on the server).
//
// Boot/Stop/Reload remain user-controllable. Auto-reload only fires when a session
// is already booted — it never starts one out of nowhere.
import { useRef, useCallback, useEffect, useState } from 'react';
import { usePreviewStore } from '../../../lib/store/previewStore';
import { useProjectStore } from '../../../lib/store/projectStore';
import { useAuthStore } from '../../../lib/store/authStore';
import { ProcessManager } from '../../../features/preview/ProcessManager';
import { apiFetch } from '../../../lib/api';

const API_BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3007';

const VIEWPORT_SIZES: { label: string; w: number }[] = [
  { label: '360', w: 360 },
  { label: '768', w: 768 },
  { label: '1024', w: 1024 },
  { label: '1280', w: 1280 },
  { label: '1440', w: 1440 },
  { label: 'Full', w: 0 },
];

export function PreviewMode() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const {
    session, logs, viewportWidth, currentRoute,
    setSession, updateSession, appendLogs, setViewportWidth, setCurrentRoute,
  } = usePreviewStore();
  const currentProject = useProjectStore((s) => s.projects[s.currentProjectId]);
  const [autoReloadAt, setAutoReloadAt] = useState<number | null>(null);
  const [shotMsg, setShotMsg]           = useState<string | null>(null);

  const sessionStatus = session?.status ?? 'idle';

  // ── Boot ───────────────────────────────────────────────────────────────────
  const handleBoot = useCallback(async () => {
    if (!currentProject) return;

    const body = {
      projectId:   currentProject.id,
      projectSlug: currentProject.slug,
      rootDir:    '/tmp/preview-stub',
      entryPoint: 'src/main.tsx',
      framework:  'react-vite' as const,
    };

    try {
      setSession({
        sessionId:   'pending',
        projectSlug: currentProject.slug,
        previewUrl:  '',
        status:      'queued',
        processes:   [],
      });

      const data = await apiFetch<{ sessionId: string; previewUrl: string }>(
        '/api/preview/boot',
        { method: 'POST', body: JSON.stringify(body) },
      );

      setSession({
        sessionId:   data.sessionId,
        projectSlug: currentProject.slug,
        previewUrl:  '',
        status:      'bundling',
        processes:   [{ name: 'dev-server', status: 'running', startedAt: Date.now() }],
      });

      void pollSession(data.sessionId, data.previewUrl);
    } catch (err) {
      updateSession({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }, [currentProject, setSession, updateSession]);

  // Poll logs every 2s; once 'booted', set the real previewUrl so the iframe loads.
  const pollSession = useCallback(async (sessionId: string, previewUrl: string) => {
    let attempts = 0;
    while (attempts < 60) {
      await sleep(2000);
      attempts++;
      try {
        const data = await apiFetch<{ logs: typeof logs; sessionStatus: string }>(
          `/api/preview/logs?sessionId=${sessionId}`,
        );
        if (data.logs.length > 0) appendLogs(data.logs);
        updateSession({ status: data.sessionStatus as typeof sessionStatus });
        if (data.sessionStatus === 'booted') {
          updateSession({ previewUrl, sessionId } as Parameters<typeof updateSession>[0]);
          if (iframeRef.current) iframeRef.current.src = previewUrl;
          break;
        }
        if (data.sessionStatus === 'error' || data.sessionStatus === 'stopped') break;
      } catch {
        break;
      }
    }
  }, [appendLogs, updateSession]);

  // ── Stop ───────────────────────────────────────────────────────────────────
  const handleStop = useCallback(async () => {
    if (!session?.sessionId || session.sessionId === 'pending') return;
    try {
      await apiFetch('/api/preview/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
    } catch { /* ignore stop errors */ }
    updateSession({ status: 'stopped' });
  }, [session, updateSession]);

  // ── Reload ─────────────────────────────────────────────────────────────────
  const handleReload = useCallback(() => {
    if (iframeRef.current) {
      // Force a hard reload by re-assigning the same src
      // eslint-disable-next-line no-self-assign
      iframeRef.current.src = iframeRef.current.src;
    }
  }, []);

  // ── Hot reload after rebundle ─────────────────────────────────────────────
  const reloadIframeWithBuster = useCallback(() => {
    if (!session?.previewUrl || !iframeRef.current) return;
    const url = new URL(session.previewUrl);
    url.searchParams.set('_t', String(Date.now()));
    iframeRef.current.src = url.toString() + currentRoute;
    setAutoReloadAt(Date.now());
  }, [session?.previewUrl, currentRoute]);

  // ── Auto-reboot on project switch / first load ───────────────────────────
  // Stop any running session for the previous project, then auto-boot for
  // the new one. This is the "feels like a real IDE" behavior — opening a
  // project should immediately try to render it.
  //
  // Critical: only auto-boot ONCE per slug. If the bundler errors, the
  // session goes to status=error with session=null, which would otherwise
  // re-trigger this effect forever (a refresh loop the user reported).
  // The user can manually re-boot via the Boot button after fixing files.
  const lastBootedSlugRef    = useRef<string | null>(null);
  const attemptedBootSlugRef = useRef<string | null>(null);
  useEffect(() => {
    const newSlug = currentProject?.slug ?? null;
    const prev    = lastBootedSlugRef.current;

    if (prev !== null && newSlug !== prev) {
      // Project changed — stop the old session and reset the boot attempt
      // flag so the new project gets one (and only one) auto-boot try.
      if (session) void handleStop();
      attemptedBootSlugRef.current = null;
    }
    lastBootedSlugRef.current = newSlug;

    // Auto-boot exactly once per slug, when no session and no in-flight bundle.
    if (
      newSlug &&
      !session &&
      sessionStatus !== 'bundling' &&
      sessionStatus !== 'booted' &&
      attemptedBootSlugRef.current !== newSlug
    ) {
      attemptedBootSlugRef.current = newSlug;
      void handleBoot();
    }
  }, [currentProject?.slug, session, sessionStatus, handleStop, handleBoot]);

  // ── SSE auto-reload ─ subscribe once we have a booted session ─────────────
  useEffect(() => {
    if (sessionStatus !== 'booted' || !currentProject?.slug) return;
    const token = useAuthStore.getState().session?.access_token;
    if (!token) return;

    // EventSource doesn't support auth headers; pass token as a query param if needed.
    // Most setups gate watch with the same JWT cookie/token via authMiddleware.
    // We send via header here using fetch + ReadableStream so we can attach the token.
    const ctrl = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function start() {
      try {
        const res = await fetch(`${API_BASE}/api/preview/watch/${currentProject!.slug}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          reconnectTimer = setTimeout(start, 3000);
          return;
        }
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let   buf     = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split('\n\n');
          buf = events.pop() ?? '';

          for (const ev of events) {
            // Look for "event: file-changed\ndata: {...}"
            if (!ev.includes('event: file-changed')) continue;
            // Debounce so a flurry of writes triggers one rebundle
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
              try {
                if (session?.sessionId && session.sessionId !== 'pending') {
                  await apiFetch('/api/preview/rebundle', {
                    method: 'POST',
                    body: JSON.stringify({
                      sessionId:   session.sessionId,
                      projectSlug: currentProject!.slug,
                    }),
                  });
                }
                reloadIframeWithBuster();
              } catch { /* show error in console mode */ }
            }, 250);
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        // Reconnect in 3s
        reconnectTimer = setTimeout(start, 3000);
      }
    }
    void start();

    return () => {
      ctrl.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (debounceTimer)  clearTimeout(debounceTimer);
    };
    // session.sessionId only — re-subscribe when session changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, currentProject?.slug, session?.sessionId]);

  // Subtle "auto-reload" indicator fades after 1.5s
  useEffect(() => {
    if (autoReloadAt == null) return;
    const t = setTimeout(() => setAutoReloadAt(null), 1500);
    return () => clearTimeout(t);
  }, [autoReloadAt]);

  // ── Screenshot ─────────────────────────────────────────────────────────────
  const handleScreenshot = useCallback(async () => {
    if (!session?.sessionId || session.sessionId === 'pending') return;
    setShotMsg('Capturing…');
    try {
      const res = await apiFetch<{ assetId: string; url: string }>(
        '/api/preview/screenshot',
        {
          method: 'POST',
          body:   JSON.stringify({ sessionId: session.sessionId }),
        },
      );
      setShotMsg(`✓ Saved (${res.assetId.slice(0, 8)})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setShotMsg(`✗ ${msg}`);
    } finally {
      setTimeout(() => setShotMsg(null), 2500);
    }
  }, [session?.sessionId]);

  const previewSrc = session?.status === 'booted' && session.previewUrl
    ? `${session.previewUrl}${currentRoute}`
    : null;

  const frameWidth = viewportWidth === 0 ? '100%' : `${viewportWidth}px`;

  // ── Project-isolation guard ────────────────────────────────────────────────
  // No selected project → don't show preview chrome at all.
  if (!currentProject) {
    return (
      <div className="abw-preview">
        <div className="abw-mode-placeholder" style={{ height: '100%' }}>
          <span className="abw-mode-placeholder__icon" aria-hidden>🗂</span>
          <span className="abw-mode-placeholder__label">No project selected</span>
          <span className="abw-mode-placeholder__sub">
            Pick a project from the top bar to preview it here.
          </span>
        </div>
      </div>
    );
  }

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

        {/* Auto-reload pulse (visible briefly after each hot reload) */}
        {autoReloadAt && (
          <span
            aria-live="polite"
            style={{
              fontSize: '0.6875rem',
              color: 'var(--accent-500)',
              fontWeight: 600,
              animation: 'abw-pulse 1s ease',
            }}
            title="Re-bundled after file change"
          >
            ⚡ live
          </span>
        )}

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
          onClick={() => void handleScreenshot()}
          style={{
            height: 26, padding: '0 var(--space-2)', border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)', background: 'var(--bg-subtle)',
            cursor: previewSrc ? 'pointer' : 'default', fontSize: '0.75rem',
            color: 'var(--text-secondary)', opacity: previewSrc ? 1 : 0.4,
          }}
          aria-label="Take screenshot"
          title="Screenshot"
          disabled={!previewSrc}
        >
          📷
        </button>

        {shotMsg && (
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>{shotMsg}</span>
        )}
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
          <EmptyState
            status={sessionStatus}
            error={session?.error}
            onBoot={handleBoot}
            projectName={currentProject.name}
          />
        )}
      </div>
    </div>
  );
}

// ── Empty / error states ─────────────────────────────────────────────────────

function EmptyState({
  status, error, onBoot, projectName,
}: {
  status:      string;
  error?:      string;
  onBoot:      () => void;
  projectName: string;
}) {
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

  // Idle / stopped — show Boot button
  return (
    <div className="abw-mode-placeholder" style={{ height: '100%' }}>
      <span className="abw-mode-placeholder__icon" aria-hidden>🖥</span>
      <span className="abw-mode-placeholder__label">
        {status === 'stopped' ? 'Preview stopped' : 'Ready to preview'}
      </span>
      <span className="abw-mode-placeholder__sub">
        Boot the preview server to see {projectName} here. Files auto-reload as the agent edits.
      </span>
      <button
        onClick={onBoot}
        style={{
          marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-4)',
          background: 'var(--accent-500)', color: '#fff', border: 'none',
          borderRadius: 'var(--radius-button)', cursor: 'pointer',
          fontWeight: 600, fontSize: '0.875rem',
        }}
        aria-label="Boot preview server"
      >
        ⚡ Boot preview
      </button>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
