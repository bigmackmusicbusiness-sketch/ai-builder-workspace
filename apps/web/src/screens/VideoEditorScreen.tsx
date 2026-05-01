// apps/web/src/screens/VideoEditorScreen.tsx — manual timeline editor.
//
// v1 scope (medium per the user's choice):
//   - Header: title + status + Render Preview / Render Final buttons
//   - Preview pane: the latest preview (or final) MP4 if rendered, otherwise
//     a "render preview" CTA so the user can see the AI's first crack
//   - Clips panel: ordered list with start/duration, trim/delete/move buttons
//   - Overlays panel: list of caption/text overlays with edit/delete
//   - Inspector: per-selected-clip controls (in/out, transitions)
//   - Add caption form: text + start + end → POST to a small /timeline/ops endpoint
//
// We don't ship a canvas timeline UI in v1 — list-based controls cover
// everything the agent's tool surface can do, and the user can ask the chat
// agent to do precision edits with the video_* tools.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { apiFetch, ApiError } from '../lib/api';
import { useAuthStore } from '../lib/store/authStore';

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

// ── Local copies of timeline shape (mirror apps/api/src/lib/timeline.ts) ──

interface VideoClip {
  id:            string;
  sourceAssetId: string;
  in:            number;
  out:           number;
  start:         number;
  transitionIn?:  { kind: 'cut' | 'fade' | 'dissolve'; durationSec: number };
  transitionOut?: { kind: 'cut' | 'fade' | 'dissolve'; durationSec: number };
}
interface AudioClip {
  id:            string;
  sourceAssetId: string;
  in:            number;
  out:           number;
  start:         number;
  volume:        number;
}
interface Overlay {
  id:    string;
  kind:  'caption' | 'text' | 'image';
  start: number;
  end:   number;
  props: Record<string, unknown>;
}
interface Timeline {
  fps:         number;
  width:       number;
  height:      number;
  durationSec: number;
  tracks:      [{ id: 'video'; kind: 'video'; clips: VideoClip[] },
                 { id: 'audio'; kind: 'audio'; clips: AudioClip[] }];
  overlays:    Overlay[];
  meta:        { aiFirstPassAt?: number; lastEditedAt?: number };
}

interface VideoRow {
  id:             string;
  title:          string;
  kind:           string;
  status:         string;
  aspectRatio:    string;
  durationSec:    number | null;
  timeline:       Timeline;
  previewAssetId: string | null;
  finalAssetId:   string | null;
  brief:          string | null;
}

// ── Component ─────────────────────────────────────────────────────────────

export function VideoEditorScreen(): JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();

  const [video, setVideo]   = useState<VideoRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [busy, setBusy]     = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Add-caption form state
  const [capText,  setCapText]  = useState('');
  const [capStart, setCapStart] = useState(0);
  const [capEnd,   setCapEnd]   = useState(3);

  const abortRef = useRef<AbortController | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const r = await apiFetch<{ video: VideoRow }>(`/api/video/${id}`);
      setVideo(r.video);

      // Resolve preview asset → publicUrl for the <video> element
      const assetId = r.video.previewAssetId ?? r.video.finalAssetId;
      if (assetId) {
        // Use the existing /api/video/:id/download redirector for the right kind
        const which = r.video.previewAssetId ? 'preview' : 'final';
        // Construct the URL with bearer for the redirect target.
        // Easier path: hit the asset directly via assets endpoint? Not needed —
        // the download endpoint 302's to the public URL, which works in <video>.
        // But <video> can't carry our Authorization header, so we resolve here.
        const token = useAuthStore.getState().session?.access_token;
        const res = await fetch(`${API_BASE}/api/video/${id}/download?kind=${which}`, {
          headers: { Authorization: `Bearer ${token ?? ''}` },
          redirect: 'manual',
        });
        // res.url is the redirect target on a manual redirect in some browsers;
        // fall back to following the redirect if needed.
        if (res.type === 'opaqueredirect' || res.status === 0) {
          // Follow normally to grab the final URL
          const followed = await fetch(`${API_BASE}/api/video/${id}/download?kind=${which}`, {
            headers: { Authorization: `Bearer ${token ?? ''}` },
          });
          setPreviewUrl(followed.url);
        } else if (res.headers.get('location')) {
          setPreviewUrl(res.headers.get('location'));
        }
      } else {
        setPreviewUrl(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load video');
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function streamSSE(path: string, label: string, query: string = ''): Promise<void> {
    const token = useAuthStore.getState().session?.access_token;
    if (!token) { setError('Not signed in.'); return; }
    setBusy(`${label}: starting…`);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${API_BASE}${path}${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6).trim()) as Record<string, unknown>;
            const t = ev['type'];
            if (t === 'progress') setBusy(`${label}: ${ev['pct']}%`);
            else if (t === 'step') setBusy(`${label}: ${(ev['message'] ?? ev['step']) as string}`);
            else if (t === 'done') { setBusy(null); void refresh(); }
            else if (t === 'error') { setError(`${label} failed: ${ev['error']}`); setBusy(null); }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stream failed');
    } finally {
      setBusy(null);
    }
  }

  async function deleteClip(clipId: string): Promise<void> {
    if (!video) return;
    setBusy(`Deleting ${clipId}…`);
    try {
      await apiFetch(`/api/video/${id}/timeline/op`, {
        method: 'POST',
        body: JSON.stringify({ op: 'delete_clip', clipId }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  }

  async function reorder(clipIds: string[]): Promise<void> {
    setBusy('Reordering…');
    try {
      await apiFetch(`/api/video/${id}/timeline/op`, {
        method: 'POST',
        body: JSON.stringify({ op: 'reorder', clipIds }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reorder failed');
    } finally {
      setBusy(null);
    }
  }

  async function addCaption(): Promise<void> {
    if (!capText.trim()) return;
    setBusy('Adding caption…');
    try {
      await apiFetch(`/api/video/${id}/timeline/op`, {
        method: 'POST',
        body: JSON.stringify({ op: 'add_caption', text: capText.trim(), start: capStart, end: capEnd }),
      });
      setCapText('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add caption failed');
    } finally {
      setBusy(null);
    }
  }

  async function deleteOverlay(overlayId: string): Promise<void> {
    setBusy('Deleting overlay…');
    try {
      await apiFetch(`/api/video/${id}/timeline/op`, {
        method: 'POST',
        body: JSON.stringify({ op: 'delete_overlay', overlayId }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  }

  const clips    = video?.timeline?.tracks?.[0]?.clips ?? [];
  const overlays = video?.timeline?.overlays ?? [];

  if (loading) return <div className="abw-screen"><div className="abw-empty-state"><p className="abw-empty-state__sub">Loading…</p></div></div>;
  if (!video)  return <div className="abw-screen"><div className="abw-empty-state"><p className="abw-empty-state__label">Video not found</p></div></div>;

  return (
    <div className="abw-screen">
      {error && (
        <div className="abw-banner abw-banner--warning" style={{ marginBottom: 'var(--space-4)' }}>
          ⚠ {error}
          <button className="abw-btn abw-btn--ghost abw-btn--xs" style={{ marginLeft: 'auto' }} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">{video.title}</h1>
          <p className="abw-screen__sub">
            {video.kind} · {video.aspectRatio} · {video.durationSec ?? 0}s
            {video.timeline?.meta?.aiFirstPassAt && <> · AI first pass {new Date(video.timeline.meta.aiFirstPassAt).toLocaleString()}</>}
            {busy && <> · <span style={{ color: 'var(--accent-500)' }}>{busy}</span></>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="abw-btn abw-btn--ghost abw-btn--sm" onClick={() => navigate({ to: '/video' as '/' })}>← Back</button>
          <button className="abw-btn abw-btn--ghost" disabled={!!busy} onClick={() => void streamSSE(`/api/video/${id}/render`, 'Preview', '?quality=preview')}>
            Render preview
          </button>
          <button className="abw-btn abw-btn--primary" disabled={!!busy} onClick={() => void streamSSE(`/api/video/${id}/render`, 'Final', '?quality=final')}>
            Render final
          </button>
        </div>
      </div>

      {/* Preview pane */}
      <div className="abw-card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        {previewUrl ? (
          <video
            controls
            src={previewUrl}
            style={{ width: '100%', maxHeight: 480, background: 'black', borderRadius: 'var(--radius-field)' }}
          />
        ) : (
          <div style={{
            background: 'var(--surface-base)', border: '1px dashed var(--border-base)',
            borderRadius: 'var(--radius-field)', padding: 'var(--space-8)', textAlign: 'center',
          }}>
            <span style={{ fontSize: '2rem', opacity: 0.4 }} aria-hidden>🎬</span>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: 'var(--space-2) 0' }}>
              No preview yet. Click <strong>Render preview</strong> above to see the timeline.
            </p>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)' }}>
        {/* Clips */}
        <section className="abw-card" style={{ padding: 'var(--space-4)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 var(--space-3)' }}>
            Clips ({clips.length})
          </h2>
          {clips.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
              No clips yet. From the studio list, click <strong>Generate</strong> to have the AI populate this timeline.
            </p>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {clips.map((c, i) => (
                <li key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-3)',
                  border: '1px solid var(--border-base)', borderRadius: 'var(--radius-field)',
                  background: 'var(--bg-elevated)',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ flex: 1, fontSize: '0.8125rem' }}>
                    <strong>{c.id}</strong>
                    <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
                      {(c.out - c.in).toFixed(1)}s · starts at {c.start.toFixed(1)}s
                    </span>
                  </span>
                  <button
                    className="abw-btn abw-btn--ghost abw-btn--xs"
                    disabled={!!busy || i === 0}
                    onClick={() => {
                      const ids = clips.map((x) => x.id);
                      const tmp = ids[i - 1]!; ids[i - 1] = ids[i]!; ids[i] = tmp;
                      void reorder(ids);
                    }}
                    title="Move up"
                  >↑</button>
                  <button
                    className="abw-btn abw-btn--ghost abw-btn--xs"
                    disabled={!!busy || i === clips.length - 1}
                    onClick={() => {
                      const ids = clips.map((x) => x.id);
                      const tmp = ids[i + 1]!; ids[i + 1] = ids[i]!; ids[i] = tmp;
                      void reorder(ids);
                    }}
                    title="Move down"
                  >↓</button>
                  <button
                    className="abw-btn abw-btn--ghost abw-btn--xs abw-btn--destructive"
                    disabled={!!busy}
                    onClick={() => void deleteClip(c.id)}
                    title="Delete clip"
                  >✕</button>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Overlays / captions */}
        <section className="abw-card" style={{ padding: 'var(--space-4)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 var(--space-3)' }}>
            Captions ({overlays.length})
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 'var(--space-3)' }}>
            {overlays.length === 0 && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>None.</p>
            )}
            {overlays.map((o) => (
              <div key={o.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                padding: 'var(--space-2)',
                border: '1px solid var(--border-base)', borderRadius: 'var(--radius-field)',
                background: 'var(--bg-elevated)',
              }}>
                <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{o.start.toFixed(1)}–{o.end.toFixed(1)}s</span>
                <span style={{ flex: 1, fontSize: '0.8125rem' }}>{String(o.props['text'] ?? '')}</span>
                <button
                  className="abw-btn abw-btn--ghost abw-btn--xs abw-btn--destructive"
                  disabled={!!busy}
                  onClick={() => void deleteOverlay(o.id)}
                >✕</button>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--border-base)', paddingTop: 'var(--space-3)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Add caption</p>
            <input
              className="abw-input"
              type="text"
              value={capText}
              onChange={(e) => setCapText(e.target.value)}
              placeholder="What should appear on screen?"
              style={{ marginBottom: 6 }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <input
                className="abw-input"
                type="number"
                step={0.1}
                value={capStart}
                onChange={(e) => setCapStart(Number(e.target.value))}
                placeholder="start"
              />
              <input
                className="abw-input"
                type="number"
                step={0.1}
                value={capEnd}
                onChange={(e) => setCapEnd(Number(e.target.value))}
                placeholder="end"
              />
            </div>
            <button
              className="abw-btn abw-btn--primary abw-btn--sm"
              disabled={!!busy || !capText.trim() || capEnd <= capStart}
              onClick={() => void addCaption()}
              style={{ width: '100%' }}
            >
              + Add caption
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
