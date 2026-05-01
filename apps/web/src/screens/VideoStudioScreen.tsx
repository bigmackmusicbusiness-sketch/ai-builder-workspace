// apps/web/src/screens/VideoStudioScreen.tsx — unified Video Studio.
// Tabs: Movies | Commercials | Shorts | Music Videos | Clipper | Library.
// Each tab has its own creation form with kind-appropriate defaults; all
// videos land in the same `video_projects` table and share the same renderer.
// Library lists everything across kinds with project + status.

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { useProjectStore } from '../lib/store/projectStore';
import { useAuthStore } from '../lib/store/authStore';
import { useNavigate } from '@tanstack/react-router';

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

// ── Types ─────────────────────────────────────────────────────────────────

type VideoKind = 'movie' | 'commercial' | 'short' | 'music_video';
type VideoStatus = 'drafting' | 'rendering' | 'ready' | 'failed';
type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3';

interface VideoRow {
  id:             string;
  title:          string;
  kind:           VideoKind;
  brief:          string | null;
  durationSec:    number | null;
  aspectRatio:    string;
  status:         VideoStatus;
  previewAssetId: string | null;
  finalAssetId:   string | null;
  costUsdCents:   number;
  error:          string | null;
  projectId:      string | null;
  createdAt:      string;
}

type TabId = VideoKind | 'clipper' | 'library';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'movie',       label: 'Movies',        icon: '🎞️' },
  { id: 'commercial',  label: 'Commercials',   icon: '📺' },
  { id: 'short',       label: 'Shorts',        icon: '📱' },
  { id: 'music_video', label: 'Music Videos',  icon: '🎵' },
  { id: 'clipper',     label: 'Clipper',       icon: '✂️' },
  { id: 'library',     label: 'Library',       icon: '📚' },
];

const KIND_DEFAULTS: Record<VideoKind, { duration: number; aspect: AspectRatio; sub: string }> = {
  movie:       { duration: 180, aspect: '16:9', sub: 'Long-form narrative video. Multi-scene with optional voiceover.' },
  commercial:  { duration:  30, aspect: '16:9', sub: 'Brand or product spot. Marketing-Studio presets.' },
  short:       { duration:  30, aspect: '9:16', sub: 'Vertical short for TikTok / Reels / YouTube Shorts.' },
  music_video: { duration: 120, aspect: '16:9', sub: 'Beat-synced video. Bring or generate a track.' },
};

const KIND_LABEL: Record<VideoKind, string> = {
  movie: 'AI Movie', commercial: 'AI Commercial', short: 'AI Short', music_video: 'AI Music Video',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  if (m < 2)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function statusBadge(s: VideoStatus): { label: string; color: string } {
  switch (s) {
    case 'drafting':  return { label: 'Drafting',  color: 'var(--text-secondary)' };
    case 'rendering': return { label: 'Rendering', color: 'var(--accent-500)' };
    case 'ready':     return { label: 'Ready',     color: 'var(--success-500)' };
    case 'failed':    return { label: 'Failed',    color: 'var(--error-500)' };
  }
}

// ── Component ─────────────────────────────────────────────────────────────

export function VideoStudioScreen(): JSX.Element {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const currentProject   = useProjectStore((s) => s.projects[s.currentProjectId]);
  const allProjects      = useProjectStore((s) => s.projects);
  const projectIdForApi  = currentProjectId === 'global' ? undefined : currentProjectId;

  // Initial tab — derived from current project's typeId so opening a project
  // routes you straight to the right creation form.
  const initialTab: TabId = useMemo(() => {
    const t = currentProject?.typeId;
    if (t === 'ai-movie')        return 'movie';
    if (t === 'ai-commercial')   return 'commercial';
    if (t === 'ai-short')        return 'short';
    if (t === 'ai-music-video')  return 'music_video';
    return 'library';
  }, [currentProject?.typeId]);

  const navigate = useNavigate();
  const [tab, setTab]         = useState<TabId>(initialTab);
  const [videos, setVideos]   = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  /** id → SSE progress message; lets the table row show live status without a global modal. */
  const [busy, setBusy]       = useState<Record<string, string>>({});
  const abortMap              = useRef<Map<string, AbortController>>(new Map());

  // Re-snap tab when the project changes
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = projectIdForApi
      ? `/api/video?projectId=${projectIdForApi}`
      : `/api/video`;
    apiFetch<{ videos: VideoRow[] }>(url)
      .then((r) => { if (!cancelled) setVideos(r.videos); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load videos.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectIdForApi]);

  function projectName(pid: string | null): string {
    if (!pid) return 'No project';
    return allProjects[pid]?.name ?? 'Unknown';
  }

  async function refresh(): Promise<void> {
    const url = projectIdForApi ? `/api/video?projectId=${projectIdForApi}` : '/api/video';
    const r = await apiFetch<{ videos: VideoRow[] }>(url);
    setVideos(r.videos);
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm('Delete this video project? This cannot be undone.')) return;
    try {
      await apiFetch(`/api/video/${id}`, { method: 'DELETE' });
      setVideos((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  /** Stream SSE from a POST endpoint, updating the row's busy message + final state. */
  async function streamSSE(
    id:   string,
    path: string,
    onEvent: (event: Record<string, unknown>) => void,
  ): Promise<void> {
    const token = useAuthStore.getState().session?.access_token;
    if (!token) { setError('Not signed in.'); return; }

    const controller = new AbortController();
    abortMap.current.set(id, controller);
    setBusy((m) => ({ ...m, [id]: 'Starting…' }));

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    '{}',
        signal:  controller.signal,
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
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try { onEvent(JSON.parse(raw) as Record<string, unknown>); }
          catch { /* malformed line, skip */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy((m) => { const next = { ...m }; delete next[id]; return next; });
      abortMap.current.delete(id);
    }
  }

  function setRowBusy(id: string, msg: string): void {
    setBusy((m) => ({ ...m, [id]: msg }));
  }

  async function handleGenerate(v: VideoRow): Promise<void> {
    if (busy[v.id]) return;
    await streamSSE(v.id, `/api/video/${v.id}/generate`, (ev) => {
      const t = ev['type'];
      if (t === 'step' || t === 'progress') {
        const msg = (ev['message'] as string)
          ?? (ev['step'] as string)
          ?? (typeof ev['pct'] === 'number' ? `${ev['pct']}%` : 'Working…');
        setRowBusy(v.id, msg);
      } else if (t === 'done') {
        void refresh();
      } else if (t === 'error') {
        setError(`Generation failed: ${ev['error'] ?? 'unknown error'}`);
      }
    });
  }

  async function handleRender(v: VideoRow, quality: 'preview' | 'final'): Promise<void> {
    if (busy[v.id]) return;
    await streamSSE(v.id, `/api/video/${v.id}/render?quality=${quality}`, (ev) => {
      const t = ev['type'];
      if (t === 'progress') {
        setRowBusy(v.id, `Rendering ${ev['pct']}%`);
      } else if (t === 'step') {
        setRowBusy(v.id, String(ev['message'] ?? ev['step'] ?? 'Working…'));
      } else if (t === 'done') {
        void refresh();
      } else if (t === 'error') {
        setError(`Render failed: ${ev['error'] ?? 'unknown error'}`);
      }
    });
  }

  function handleOpenEditor(v: VideoRow): void {
    void navigate({ to: ('/edit/video/' + v.id) as '/' });
  }

  // The Library tab shows all kinds; per-kind tabs filter to just that kind.
  const visibleVideos = useMemo(() => {
    if (tab === 'library' || tab === 'clipper') return videos;
    return videos.filter((v) => v.kind === tab);
  }, [videos, tab]);

  return (
    <div className="abw-screen">
      {/* Error banner */}
      {error && (
        <div className="abw-banner abw-banner--warning" style={{ marginBottom: 'var(--space-4)' }}>
          ⚠ {error}
          <button className="abw-btn abw-btn--ghost abw-btn--xs" style={{ marginLeft: 'auto' }} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">
            {currentProject && currentProjectId !== 'global'
              ? `${currentProject.name} · Video Studio`
              : 'Video Studio'}
          </h1>
          <p className="abw-screen__sub">
            {loading
              ? 'Loading…'
              : videos.length === 0
              ? 'AI-generated movies, commercials, shorts, and music videos.'
              : `${videos.length} video${videos.length !== 1 ? 's' : ''} ${projectIdForApi ? 'in this project' : 'across all projects'}`}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Video Studio sections">
        {TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`abw-screen__tab${tab === id ? ' abw-screen__tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            <span aria-hidden style={{ marginRight: 6 }}>{icon}</span>{label}
          </button>
        ))}
      </div>

      {tab === 'clipper' && (
        <ClipperTab projectId={projectIdForApi} onError={setError} />
      )}

      {tab !== 'clipper' && tab !== 'library' && (
        <CreateForm
          kind={tab as VideoKind}
          projectId={projectIdForApi}
          onCreated={() => void refresh()}
          onError={setError}
        />
      )}

      {/* Video list (per-tab or full library) */}
      {(tab === 'library' || tab !== 'clipper') && (
        loading ? (
          <div className="abw-empty-state">
            <p className="abw-empty-state__sub">Loading videos…</p>
          </div>
        ) : visibleVideos.length === 0 ? (
          <div className="abw-empty-state">
            <span className="abw-empty-state__icon" aria-hidden>🎬</span>
            <p className="abw-empty-state__label">{tab === 'library' ? 'No videos yet' : `No ${KIND_LABEL[tab as VideoKind]}s yet`}</p>
            <p className="abw-empty-state__sub">
              {tab === 'library'
                ? 'Use a creation tab above to make your first video.'
                : 'Use the form above to create one.'}
            </p>
          </div>
        ) : (
          <div className="abw-table-wrap">
            <table className="abw-table" aria-label="Videos">
              <thead>
                <tr>
                  <th>Title</th>
                  <th style={{ width: 120 }}>Kind</th>
                  {tab === 'library' && <th style={{ width: 160 }}>Project</th>}
                  <th style={{ width:  90 }}>Aspect</th>
                  <th style={{ width:  90 }}>Length</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 110 }}>Created</th>
                  <th style={{ width: 360 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visibleVideos.map((v) => {
                  const badge = statusBadge(v.status);
                  const isBusy = !!busy[v.id];
                  return (
                    <tr key={v.id}>
                      <td><span className="abw-table__name" style={{ fontWeight: 600 }}>{v.title}</span></td>
                      <td><span className="abw-badge" style={{ fontSize: '0.625rem' }}>{KIND_LABEL[v.kind]}</span></td>
                      {tab === 'library' && (
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{projectName(v.projectId)}</td>
                      )}
                      <td style={{ fontSize: '0.75rem' }}>{v.aspectRatio}</td>
                      <td style={{ fontSize: '0.75rem' }}>{v.durationSec ? `${v.durationSec}s` : '—'}</td>
                      <td>
                        <span style={{ color: isBusy ? 'var(--accent-500)' : badge.color, fontSize: '0.75rem', fontWeight: 600 }}>
                          ● {isBusy ? busy[v.id] : badge.label}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{relativeTime(v.createdAt)}</td>
                      <td>
                        <div className="abw-table__actions" style={{ flexWrap: 'wrap' }}>
                          <button
                            className="abw-btn abw-btn--primary abw-btn--xs"
                            disabled={isBusy}
                            onClick={() => void handleGenerate(v)}
                            title="AI generates scenes onto the timeline"
                          >
                            ✨ Generate
                          </button>
                          <button
                            className="abw-btn abw-btn--ghost abw-btn--xs"
                            disabled={isBusy}
                            onClick={() => handleOpenEditor(v)}
                            title="Open the timeline editor"
                          >
                            ✎ Edit
                          </button>
                          <button
                            className="abw-btn abw-btn--ghost abw-btn--xs"
                            disabled={isBusy}
                            onClick={() => void handleRender(v, 'final')}
                            title="Render the final MP4 from the timeline"
                          >
                            ⏵ Render
                          </button>
                          <button
                            className="abw-btn abw-btn--ghost abw-btn--xs"
                            disabled={!v.finalAssetId}
                            onClick={() => window.open(`${API_BASE}/api/video/${v.id}/download?kind=final`, '_blank')}
                          >
                            ⬇ MP4
                          </button>
                          <button
                            className="abw-btn abw-btn--ghost abw-btn--xs abw-btn--destructive"
                            disabled={isBusy}
                            onClick={() => void handleDelete(v.id)}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ── Per-kind creation form ──────────────────────────────────────────────────

interface CreateFormProps {
  kind:       VideoKind;
  projectId?: string;
  onCreated:  () => void;
  onError:    (msg: string) => void;
}

function CreateForm({ kind, projectId, onCreated, onError }: CreateFormProps): JSX.Element {
  const def = KIND_DEFAULTS[kind];
  const [title, setTitle]             = useState('');
  const [brief, setBrief]             = useState('');
  const [duration, setDuration]       = useState<number>(def.duration);
  const [aspect, setAspect]           = useState<AspectRatio>(def.aspect);
  const [submitting, setSubmitting]   = useState(false);

  // Reset form when kind changes
  useEffect(() => {
    setTitle('');
    setBrief('');
    setDuration(def.duration);
    setAspect(def.aspect);
  }, [kind, def.duration, def.aspect]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!title.trim()) {
      onError('Title is required.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/api/video', {
        method: 'POST',
        body: JSON.stringify({
          title:        title.trim(),
          kind,
          brief:        brief.trim() || undefined,
          durationSec:  duration,
          aspectRatio:  aspect,
          projectId,
        }),
      });
      setTitle('');
      setBrief('');
      onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to create video');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="abw-card"
      style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}
    >
      <h2 style={{ fontSize: '1.0625rem', fontWeight: 600, margin: 0 }}>
        {KIND_LABEL[kind]}
      </h2>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '4px 0 var(--space-4)' }}>
        {def.sub}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 'var(--space-4)' }}>
        <label className="abw-field">
          <span className="abw-field__label">Title *</span>
          <input
            className="abw-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === 'movie' ? 'The Last Hour' : kind === 'commercial' ? 'Acme launch spot' : kind === 'short' ? 'Quick demo' : 'Track music video'}
            required
          />
        </label>
        <label className="abw-field">
          <span className="abw-field__label">Duration (s)</span>
          <input
            className="abw-input"
            type="number"
            min={3}
            max={600}
            value={duration}
            onChange={(e) => setDuration(Math.max(3, Math.min(600, parseInt(e.target.value, 10) || def.duration)))}
          />
        </label>
        <label className="abw-field">
          <span className="abw-field__label">Aspect</span>
          <select
            className="abw-input"
            value={aspect}
            onChange={(e) => setAspect(e.target.value as AspectRatio)}
          >
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="4:3">4:3</option>
          </select>
        </label>
      </div>

      <label className="abw-field" style={{ marginTop: 'var(--space-4)' }}>
        <span className="abw-field__label">Brief / prompt</span>
        <textarea
          className="abw-input"
          rows={3}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={
            kind === 'movie'       ? 'A retired detective gets pulled back in for one final case in 1970s Tokyo. Two acts, three scenes each…' :
            kind === 'commercial'  ? 'Sleek 30s spot for a new headphone — lifestyle, urban, golden-hour light, ending on logo + tagline…' :
            kind === 'short'       ? 'Hook: "I tried this for 30 days." Fast cuts, on-screen text, vertical, ending with a CTA…' :
            'Genre: synthwave. Drops at 0:48 and 1:36. Mood: nostalgic, neon, late-night drive…'
          }
        />
      </label>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
        <button type="submit" className="abw-btn abw-btn--primary" disabled={submitting || !title.trim()}>
          {submitting ? 'Creating…' : `+ Create ${KIND_LABEL[kind]}`}
        </button>
      </div>
    </form>
  );
}

// ── Clipper tab — drop-zone / URL form + jobs list with live progress ──────

interface ClipperJob {
  id:                  string;
  sourceKind:          'upload' | 'youtube' | 'url';
  sourceRef:           string;
  sourceDurationSec:   number | null;
  targetClipCount:     number;
  targetClipLengthSec: number;
  captionStyle:        string;
  status:              string;
  progressPct:         number;
  candidates:          unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clips:               Array<{ assetId: string; assetUrl: string; start: number; end: number; score: number; reason: string; transcriptSnippet?: string }>;
  error:               string | null;
  createdAt:           string;
}

function ClipperTab({ projectId, onError }: { projectId?: string; onError: (msg: string) => void }): JSX.Element {
  const [jobs, setJobs] = useState<ClipperJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Form state
  const [inputMode, setInputMode] = useState<'upload' | 'youtube' | 'url'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [directUrl,  setDirectUrl]  = useState('');
  const [clipCount,  setClipCount]  = useState(5);
  const [clipLength, setClipLength] = useState(30);
  const [captionStyle, setCaptionStyle] = useState<'viral' | 'subtle'>('viral');
  const [acknowledge, setAcknowledge] = useState(false);

  const refresh = async (): Promise<void> => {
    try {
      const url = projectId ? `/api/clipper/jobs?projectId=${projectId}` : '/api/clipper/jobs';
      const r = await apiFetch<{ jobs: ClipperJob[] }>(url);
      setJobs(r.jobs);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to load clipper jobs');
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Lightweight polling for active jobs
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status !== 'done' && j.status !== 'failed');
    if (!hasActive) return;
    const t = setInterval(() => { void refresh(); }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  async function handleCreate(): Promise<void> {
    setCreating(true);
    try {
      let sourceKind: 'upload' | 'youtube' | 'url' = inputMode;
      let sourceRef:  string;

      if (inputMode === 'upload') {
        if (!file) { onError('Pick a file first.'); return; }
        // Upload to /api/assets/upload first, then pass the asset id
        const fd = new FormData();
        fd.append('file', file);
        if (projectId) fd.append('projectId', projectId);
        const upRes = await apiFetch<{ asset: { id: string; url: string } }>('/api/assets/upload', { method: 'POST', body: fd as unknown as BodyInit });
        sourceRef = upRes.asset.id;
      } else if (inputMode === 'youtube') {
        if (!youtubeUrl.trim()) { onError('Paste a YouTube URL.'); return; }
        sourceRef = youtubeUrl.trim();
        sourceKind = 'youtube';
      } else {
        if (!directUrl.trim()) { onError('Paste a direct URL.'); return; }
        sourceRef = directUrl.trim();
        sourceKind = 'url';
      }

      await apiFetch('/api/clipper/jobs', {
        method: 'POST',
        body: JSON.stringify({
          sourceKind,
          sourceRef,
          targetClipCount:     clipCount,
          targetClipLengthSec: clipLength,
          captionStyle,
          projectId,
          acknowledgeRights:   inputMode === 'upload' ? true : acknowledge,
        }),
      });

      // Reset form
      setFile(null);
      setYoutubeUrl('');
      setDirectUrl('');
      setAcknowledge(false);
      void refresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to start clipper job');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm('Delete this clipper job? Output clips will be removed.')) return;
    try {
      await apiFetch(`/api/clipper/jobs/${id}`, { method: 'DELETE' });
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <>
      {/* Job creation form */}
      <div className="abw-card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: '1.0625rem', fontWeight: 600, margin: 0 }}>✂️ AI Clipper</h2>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '4px 0 var(--space-4)' }}>
          Drop a long video. The pipeline detects scenes, transcribes via Whisper (if <code>OPENAI_API_KEY</code> is in your vault), scores hook potential per scene, and outputs vertical 9:16 clips with viral-style captions.
        </p>

        {/* Input mode tabs */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          {(['upload', 'youtube', 'url'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`abw-btn abw-btn--${inputMode === m ? 'secondary' : 'ghost'} abw-btn--sm`}
              onClick={() => setInputMode(m)}
            >
              {m === 'upload' ? '📁 File' : m === 'youtube' ? '▶ YouTube' : '🔗 URL'}
            </button>
          ))}
        </div>

        {inputMode === 'upload' && (
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ marginBottom: 'var(--space-3)', fontSize: '0.8125rem' }}
          />
        )}
        {inputMode === 'youtube' && (
          <input
            className="abw-input"
            type="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=…"
            style={{ marginBottom: 'var(--space-3)' }}
          />
        )}
        {inputMode === 'url' && (
          <input
            className="abw-input"
            type="url"
            value={directUrl}
            onChange={(e) => setDirectUrl(e.target.value)}
            placeholder="https://example.com/video.mp4"
            style={{ marginBottom: 'var(--space-3)' }}
          />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <label className="abw-field">
            <span className="abw-field__label">Clips</span>
            <input className="abw-input" type="number" min={1} max={20} value={clipCount}
              onChange={(e) => setClipCount(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 5)))} />
          </label>
          <label className="abw-field">
            <span className="abw-field__label">Length (s)</span>
            <input className="abw-input" type="number" min={10} max={180} value={clipLength}
              onChange={(e) => setClipLength(Math.max(10, Math.min(180, parseInt(e.target.value, 10) || 30)))} />
          </label>
          <label className="abw-field">
            <span className="abw-field__label">Captions</span>
            <select className="abw-input" value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value as 'viral' | 'subtle')}>
              <option value="viral">Viral (recommended)</option>
              <option value="subtle">Subtle</option>
            </select>
          </label>
        </div>

        {(inputMode === 'youtube' || inputMode === 'url') && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
            <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />
            I have rights to use this content (or it's licensed for my use).
          </label>
        )}

        <button
          className="abw-btn abw-btn--primary"
          disabled={creating || (inputMode === 'upload' ? !file : (inputMode === 'youtube' ? !youtubeUrl.trim() : !directUrl.trim()))
                            || ((inputMode === 'youtube' || inputMode === 'url') && !acknowledge)}
          onClick={() => void handleCreate()}
        >
          {creating ? 'Starting…' : 'Start clipping'}
        </button>
      </div>

      {/* Jobs list */}
      <div className="abw-card" style={{ padding: 'var(--space-4)' }}>
        <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, margin: '0 0 var(--space-3)' }}>Recent jobs</h3>
        {loading ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>Loading…</p>
        ) : jobs.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>No jobs yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {jobs.map((j) => (
              <div key={j.id} style={{
                padding: 'var(--space-3)',
                border: '1px solid var(--border-base)',
                borderRadius: 'var(--radius-field)',
                background: 'var(--bg-elevated)',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                    {j.sourceKind === 'upload' ? '📁 Uploaded file' : j.sourceKind === 'youtube' ? '▶ YouTube' : '🔗 URL'}
                  </span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {j.sourceKind === 'upload' ? j.sourceRef.slice(0, 8) : j.sourceRef}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: j.status === 'done' ? 'var(--success-500)' : j.status === 'failed' ? 'var(--error-500)' : 'var(--accent-500)', fontWeight: 600 }}>
                    {j.status} · {j.progressPct}%
                  </span>
                  <button className="abw-btn abw-btn--ghost abw-btn--xs abw-btn--destructive" onClick={() => void handleDelete(j.id)}>✕</button>
                </div>
                <div style={{ marginTop: 6, height: 4, background: 'var(--neutral-200)', borderRadius: 'var(--radius-pill)' }}>
                  <div style={{ width: `${j.progressPct}%`, height: '100%', background: j.status === 'failed' ? 'var(--error-500)' : 'var(--accent-500)', borderRadius: 'var(--radius-pill)', transition: 'width 0.3s' }} />
                </div>
                {j.error && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--error-500)', margin: '6px 0 0' }}>⚠ {j.error}</p>
                )}
                {j.clips.length > 0 && (
                  <div style={{ marginTop: 'var(--space-2)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-2)' }}>
                    {j.clips.map((c, i) => (
                      <a key={c.assetId} href={c.assetUrl} target="_blank" rel="noreferrer" style={{
                        padding: 'var(--space-2)',
                        border: '1px solid var(--border-base)',
                        borderRadius: 'var(--radius-field)',
                        background: 'var(--bg-base)',
                        textDecoration: 'none',
                        color: 'inherit',
                        fontSize: '0.6875rem',
                        display: 'block',
                      }}>
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>Clip {i + 1} · {Math.round(c.score)}</div>
                        <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                          {c.reason}
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
