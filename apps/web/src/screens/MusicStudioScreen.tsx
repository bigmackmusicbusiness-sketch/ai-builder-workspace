// apps/web/src/screens/MusicStudioScreen.tsx — Music Studio.
// Tabs: Beat (rap) | Cinematic | Library. SSE-driven generation, MP3/ZIP downloads.
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { useProjectStore } from '../lib/store/projectStore';
import { useAuthStore } from '../lib/store/authStore';

// ── Types ─────────────────────────────────────────────────────────────────────

type MusicMode   = 'beat' | 'cinematic';
type MusicStatus = 'generating' | 'separating' | 'packaging' | 'ready' | 'failed';
type ActiveTab   = 'beat' | 'cinematic' | 'library';

type BeatVibe    = 'trap' | 'boom_bap' | 'drill' | 'lo_fi' | 'west_coast' | 'melodic';
type CinematicMood = 'heroic' | 'tense' | 'melancholy' | 'uplifting' | 'dark' | 'romantic' | 'mysterious';
type CinematicInst = 'orchestral' | 'electronic' | 'hybrid' | 'piano_only' | 'ambient';

interface MusicTrack {
  id:           string;
  title:        string;
  mode:         MusicMode;
  durationSec:  number;
  bpm:          number | null;
  key:          string | null;
  status:       MusicStatus;
  costUsdCents: number | null;
  mp3AssetId:   string | null;
  zipAssetId:   string | null;
  error:        string | null;
  createdAt:    string;
}

interface BeatForm {
  vibe:        BeatVibe;
  bpm:         number;
  key:         string;
  durationSec: number;
  description: string;
}

interface CinematicForm {
  mood:          CinematicMood;
  instrumentation: CinematicInst;
  durationSec:   number;
  sceneDesc:     string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

const BEAT_VIBES: { id: BeatVibe; label: string }[] = [
  { id: 'trap',       label: 'Trap'       },
  { id: 'boom_bap',   label: 'Boom-Bap'   },
  { id: 'drill',      label: 'Drill'      },
  { id: 'lo_fi',      label: 'Lo-Fi'      },
  { id: 'west_coast', label: 'West Coast' },
  { id: 'melodic',    label: 'Melodic'    },
];

const CINEMATIC_MOODS: { id: CinematicMood; label: string }[] = [
  { id: 'heroic',      label: 'Heroic'      },
  { id: 'tense',       label: 'Tense'       },
  { id: 'melancholy',  label: 'Melancholy'  },
  { id: 'uplifting',   label: 'Uplifting'   },
  { id: 'dark',        label: 'Dark'        },
  { id: 'romantic',    label: 'Romantic'    },
  { id: 'mysterious',  label: 'Mysterious'  },
];

const CINEMATIC_INSTS: { id: CinematicInst; label: string }[] = [
  { id: 'orchestral', label: 'Orchestral' },
  { id: 'electronic', label: 'Electronic' },
  { id: 'hybrid',     label: 'Hybrid'     },
  { id: 'piano_only', label: 'Piano Only' },
  { id: 'ambient',    label: 'Ambient'    },
];

const BEAT_DURATIONS: { sec: number; label: string }[] = [
  { sec: 30,  label: '30 sec' },
  { sec: 60,  label: '1 min'  },
  { sec: 120, label: '2 min'  },
  { sec: 180, label: '3 min'  },
];

const CINEMATIC_DURATIONS: { sec: number; label: string }[] = [
  { sec: 30,  label: '30 sec' },
  { sec: 60,  label: '1 min'  },
  { sec: 120, label: '2 min'  },
  { sec: 180, label: '3 min'  },
  { sec: 300, label: '5 min'  },
];

const DEFAULT_BEAT_FORM: BeatForm = {
  vibe:        'trap',
  bpm:         140,
  key:         '',
  durationSec: 60,
  description: '',
};

const DEFAULT_CINEMATIC_FORM: CinematicForm = {
  mood:            'heroic',
  instrumentation: 'orchestral',
  durationSec:     120,
  sceneDesc:       '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  if (m < 2)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function durationLabel(sec: number): string {
  if (sec < 60)  return `${sec} sec`;
  if (sec < 300) return `${Math.round(sec / 60)} min`;
  return `${sec / 60} min`;
}

function costLabel(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function statusColor(status: MusicStatus): string {
  if (status === 'ready')   return 'var(--success-500)';
  if (status === 'failed')  return 'var(--error-500)';
  return 'var(--accent-500)';
}

function statusLabel(status: MusicStatus): string {
  const map: Record<MusicStatus, string> = {
    generating: 'Generating',
    separating: 'Separating',
    packaging:  'Packaging',
    ready:      'Ready',
    failed:     'Failed',
  };
  return map[status] ?? status;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MusicStudioScreen(): JSX.Element {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const currentProject   = useProjectStore((s) => s.projects[s.currentProjectId]);
  const projectIdForApi  = currentProjectId === 'global' ? undefined : currentProjectId;

  const [activeTab, setActiveTab] = useState<ActiveTab>('beat');
  const [tracks, setTracks]       = useState<MusicTrack[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const [beatForm, setBeatForm]         = useState<BeatForm>(DEFAULT_BEAT_FORM);
  const [cinematicForm, setCinematicForm] = useState<CinematicForm>(DEFAULT_CINEMATIC_FORM);
  const [generating, setGenerating]     = useState(false);
  const [progress, setProgress]         = useState<string[]>([]);
  const [activeStep, setActiveStep]     = useState<string | null>(null);
  const abortRef                        = useRef<AbortController | null>(null);

  // ── Fetch tracks on mount / project change ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = projectIdForApi
      ? `/api/music?projectId=${projectIdForApi}`
      : `/api/music`;
    apiFetch<{ tracks: MusicTrack[] }>(url)
      .then((r) => { if (!cancelled) setTracks(r.tracks); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load tracks.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectIdForApi]);

  // ── Generate via SSE ───────────────────────────────────────────────────────
  async function handleGenerate(mode: MusicMode) {
    const token = useAuthStore.getState().session?.access_token;
    if (!token) { setError('Not signed in.'); return; }

    setGenerating(true);
    setError(null);
    setProgress([`Starting ${mode} generation…`]);
    setActiveStep('plan');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Auto-generate a title from the form inputs (API requires title: min(1))
      const autoTitle = mode === 'beat'
        ? `${BEAT_VIBES.find((v) => v.id === beatForm.vibe)?.label ?? beatForm.vibe} Beat — ${beatForm.bpm} BPM`
        : `${CINEMATIC_MOODS.find((m) => m.id === cinematicForm.mood)?.label ?? cinematicForm.mood} ${CINEMATIC_INSTS.find((i) => i.id === cinematicForm.instrumentation)?.label ?? cinematicForm.instrumentation} Score`;

      const body: Record<string, unknown> = {
        mode,
        title:     autoTitle,
        projectId: projectIdForApi,
      };

      if (mode === 'beat') {
        body['vibe']        = beatForm.vibe;
        body['bpm']         = beatForm.bpm;
        body['key']         = beatForm.key || undefined;
        body['durationSec'] = beatForm.durationSec;
        body['description'] = beatForm.description || undefined;
      } else {
        body['mood']            = cinematicForm.mood;
        body['instrumentation'] = cinematicForm.instrumentation;
        body['durationSec']     = cinematicForm.durationSec;
        body['sceneDesc']       = cinematicForm.sceneDesc || undefined;
      }

      const res = await fetch(`${API_BASE}/api/music/generate`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        throw new Error(errBody.error ?? 'Generation failed');
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

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

          try {
            const event = JSON.parse(raw) as {
              type:     string;
              step?:    string;
              segments?: number;
              trackId?: string;
              error?:   string;
            };

            if (event.type === 'step') {
              setActiveStep(event.step ?? null);
              if (event.step === 'plan') {
                setProgress((p) => [...p, '→ Planning composition…']);
              } else if (event.step === 'generating') {
                const seg = event.segments ? ` (${event.segments} segments)` : '';
                setProgress((p) => [...p, `→ Generating audio${seg}…`]);
              } else if (event.step === 'stitch') {
                setProgress((p) => [...p, '→ Stitching segments…']);
              } else if (event.step === 'convert') {
                setProgress((p) => [...p, '→ Converting to MP3…']);
              } else if (event.step === 'separate') {
                setProgress((p) => [...p, '→ Separating stems…']);
              } else if (event.step === 'package') {
                setProgress((p) => [...p, '→ Packaging ZIP…']);
              } else if (event.step === 'upload') {
                setProgress((p) => [...p, '→ Uploading to storage…']);
              }
            } else if (event.type === 'done') {
              setProgress((p) => [...p, '✓ Done.']);
              setActiveStep(null);
              const url = projectIdForApi ? `/api/music?projectId=${projectIdForApi}` : `/api/music`;
              const fresh = await apiFetch<{ tracks: MusicTrack[] }>(url);
              setTracks(fresh.tracks);
              setActiveTab('library');
            } else if (event.type === 'error') {
              throw new Error(event.error ?? 'Generation failed');
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message && !parseErr.message.startsWith('Unexpected')) {
              throw parseErr;
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setProgress((p) => [...p, `✗ ${msg}`]);
    } finally {
      setGenerating(false);
      setActiveStep(null);
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
    setActiveStep(null);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this track?')) return;
    try {
      await apiFetch(`/api/music/${id}`, { method: 'DELETE' });
      setTracks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  function handleDownload(id: string, format: 'mp3' | 'zip') {
    const url   = `${API_BASE}/api/music/${id}/download?format=${format}`;
    const token = useAuthStore.getState().session?.access_token;
    fetch(url, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .then((res) => {
        if (res.redirected) { window.open(res.url, '_blank'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Download failed'));
  }

  const sortedTracks = useMemo(
    () => [...tracks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [tracks],
  );

  // ── Progress log (shared between tabs) ────────────────────────────────────
  const progressLog = progress.length > 0 && (
    <div
      style={{
        marginTop:    'var(--space-5)',
        padding:      'var(--space-3)',
        background:   'var(--surface-base)',
        border:       '1px solid var(--border-base)',
        borderRadius: 'var(--radius-field)',
        fontFamily:   'var(--font-mono, monospace)',
        fontSize:     '0.75rem',
        lineHeight:   1.6,
        maxHeight:    220,
        overflowY:    'auto',
      }}
      aria-live="polite"
      aria-atomic="false"
    >
      {progress.map((line, i) => (
        <div
          key={i}
          style={{ color: line.startsWith('✗') ? 'var(--error-500)' : 'var(--text-secondary)' }}
        >
          {line}
        </div>
      ))}
      {activeStep && (
        <div style={{ color: 'var(--accent-500)', marginTop: 'var(--space-1)' }}>
          {activeStep}…
        </div>
      )}
    </div>
  );

  return (
    <div className="abw-screen">
      {/* Error banner */}
      {error && (
        <div className="abw-banner abw-banner--warning" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
          <button
            className="abw-btn abw-btn--ghost abw-btn--xs"
            style={{ marginLeft: 'auto' }}
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Music Studio</h1>
          <p className="abw-screen__sub">
            {loading
              ? 'Loading…'
              : `${tracks.length} track${tracks.length !== 1 ? 's' : ''} · ${currentProject?.name ?? 'All projects'}`}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-5)', borderBottom: '1px solid var(--border-base)', paddingBottom: 'var(--space-1)' }}>
        {(['beat', 'cinematic', 'library'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`abw-btn abw-btn--ghost${activeTab === tab ? ' abw-btn--secondary' : ''}`}
            onClick={() => setActiveTab(tab)}
            style={{
              borderColor: activeTab === tab ? 'var(--accent-500)' : 'transparent',
              borderBottomColor: activeTab === tab ? 'var(--accent-500)' : 'transparent',
              textTransform: 'capitalize',
            }}
          >
            {tab === 'beat' ? 'Beat' : tab === 'cinematic' ? 'Cinematic' : `Library (${tracks.length})`}
          </button>
        ))}
      </div>

      {/* Beat tab */}
      {activeTab === 'beat' && (
        <div className="abw-card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
          {/* Vibe pills */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Vibe</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {BEAT_VIBES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`abw-btn abw-btn--ghost${beatForm.vibe === v.id ? ' abw-btn--secondary' : ''}`}
                  onClick={() => setBeatForm({ ...beatForm, vibe: v.id })}
                  style={{ borderColor: beatForm.vibe === v.id ? 'var(--accent-500)' : 'var(--border-base)' }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* BPM + Key */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
            <label className="abw-field">
              <span className="abw-field__label">BPM — {beatForm.bpm}</span>
              <input
                className="abw-input"
                type="range"
                min={60}
                max={200}
                value={beatForm.bpm}
                onChange={(e) => setBeatForm({ ...beatForm, bpm: parseInt(e.target.value, 10) })}
                style={{ padding: 0, height: 'auto', cursor: 'pointer' }}
              />
            </label>
            <label className="abw-field">
              <span className="abw-field__label">Key (optional)</span>
              <input
                className="abw-input"
                value={beatForm.key}
                onChange={(e) => setBeatForm({ ...beatForm, key: e.target.value })}
                placeholder="e.g. C minor"
              />
            </label>
          </div>

          {/* Duration */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Duration</p>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {BEAT_DURATIONS.map((d) => (
                <button
                  key={d.sec}
                  type="button"
                  className={`abw-btn abw-btn--ghost${beatForm.durationSec === d.sec ? ' abw-btn--secondary' : ''}`}
                  onClick={() => setBeatForm({ ...beatForm, durationSec: d.sec })}
                  style={{ borderColor: beatForm.durationSec === d.sec ? 'var(--accent-500)' : 'var(--border-base)' }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <label className="abw-field" style={{ marginBottom: 'var(--space-5)' }}>
            <span className="abw-field__label">Describe your beat</span>
            <textarea
              className="abw-input"
              rows={3}
              value={beatForm.description}
              onChange={(e) => setBeatForm({ ...beatForm, description: e.target.value })}
              placeholder="Dark 808s, punchy snare on the 2 and 4, eerie violin sample, spacious hi-hats…"
            />
          </label>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="abw-btn abw-btn--primary"
              disabled={generating}
              onClick={() => void handleGenerate('beat')}
            >
              {generating ? 'Generating…' : 'Generate Beat'}
            </button>
            {generating && (
              <button type="button" className="abw-btn abw-btn--ghost" onClick={handleCancel}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="abw-btn abw-btn--ghost"
              disabled={generating}
              onClick={() => setBeatForm(DEFAULT_BEAT_FORM)}
            >
              Reset
            </button>
          </div>

          {progressLog}
        </div>
      )}

      {/* Cinematic tab */}
      {activeTab === 'cinematic' && (
        <div className="abw-card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
          {/* Mood pills */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Mood</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {CINEMATIC_MOODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`abw-btn abw-btn--ghost${cinematicForm.mood === m.id ? ' abw-btn--secondary' : ''}`}
                  onClick={() => setCinematicForm({ ...cinematicForm, mood: m.id })}
                  style={{ borderColor: cinematicForm.mood === m.id ? 'var(--accent-500)' : 'var(--border-base)' }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Instrumentation pills */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Instrumentation</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {CINEMATIC_INSTS.map((inst) => (
                <button
                  key={inst.id}
                  type="button"
                  className={`abw-btn abw-btn--ghost${cinematicForm.instrumentation === inst.id ? ' abw-btn--secondary' : ''}`}
                  onClick={() => setCinematicForm({ ...cinematicForm, instrumentation: inst.id })}
                  style={{ borderColor: cinematicForm.instrumentation === inst.id ? 'var(--accent-500)' : 'var(--border-base)' }}
                >
                  {inst.label}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Duration</p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {CINEMATIC_DURATIONS.map((d) => (
                <button
                  key={d.sec}
                  type="button"
                  className={`abw-btn abw-btn--ghost${cinematicForm.durationSec === d.sec ? ' abw-btn--secondary' : ''}`}
                  onClick={() => setCinematicForm({ ...cinematicForm, durationSec: d.sec })}
                  style={{ borderColor: cinematicForm.durationSec === d.sec ? 'var(--accent-500)' : 'var(--border-base)' }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scene description */}
          <label className="abw-field" style={{ marginBottom: 'var(--space-5)' }}>
            <span className="abw-field__label">Scene description</span>
            <textarea
              className="abw-input"
              rows={3}
              value={cinematicForm.sceneDesc}
              onChange={(e) => setCinematicForm({ ...cinematicForm, sceneDesc: e.target.value })}
              placeholder="A lone warrior stands at the edge of a cliff overlooking a burning kingdom…"
            />
          </label>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="abw-btn abw-btn--primary"
              disabled={generating}
              onClick={() => void handleGenerate('cinematic')}
            >
              {generating ? 'Generating…' : 'Generate Score'}
            </button>
            {generating && (
              <button type="button" className="abw-btn abw-btn--ghost" onClick={handleCancel}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="abw-btn abw-btn--ghost"
              disabled={generating}
              onClick={() => setCinematicForm(DEFAULT_CINEMATIC_FORM)}
            >
              Reset
            </button>
          </div>

          {progressLog}
        </div>
      )}

      {/* Library tab */}
      {activeTab === 'library' && (
        loading ? (
          <div className="abw-empty-state">
            <p className="abw-empty-state__sub">Loading tracks…</p>
          </div>
        ) : sortedTracks.length === 0 ? (
          <div className="abw-empty-state">
            <span className="abw-empty-state__icon" aria-hidden>🎵</span>
            <p className="abw-empty-state__label">No tracks yet</p>
            <p className="abw-empty-state__sub">
              Generate a rap beat or cinematic score to get started.
            </p>
            <button className="abw-btn abw-btn--primary" onClick={() => setActiveTab('beat')}>
              + Generate a beat
            </button>
          </div>
        ) : (
          <div className="abw-table-wrap">
            <table className="abw-table" aria-label="Music library">
              <thead>
                <tr>
                  <th>Title</th>
                  <th style={{ width: 100 }}>Mode</th>
                  <th style={{ width: 90 }}>Duration</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 80 }}>Cost</th>
                  <th style={{ width: 110 }}>Created</th>
                  <th style={{ width: 200 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {sortedTracks.map((track) => (
                  <tr key={track.id}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{track.title}</span>
                      {track.bpm && (
                        <span style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>
                          {track.bpm} BPM{track.key ? ` · ${track.key}` : ''}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="abw-badge" style={{ fontSize: '0.625rem', textTransform: 'capitalize' }}>
                        {track.mode}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {durationLabel(track.durationSec)}
                    </td>
                    <td>
                      <span style={{ color: statusColor(track.status), fontSize: '0.75rem', fontWeight: 600 }}>
                        {statusLabel(track.status)}
                      </span>
                      {track.status === 'failed' && track.error && (
                        <span
                          title={track.error}
                          style={{
                            display:      'block',
                            fontSize:     '0.625rem',
                            color:        'var(--text-tertiary)',
                            maxWidth:     100,
                            overflow:     'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace:   'nowrap',
                          }}
                        >
                          {track.error}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {costLabel(track.costUsdCents)}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {relativeTime(track.createdAt)}
                    </td>
                    <td>
                      <div className="abw-table__actions">
                        <button
                          className="abw-btn abw-btn--ghost abw-btn--xs"
                          disabled={!track.mp3AssetId}
                          onClick={() => handleDownload(track.id, 'mp3')}
                          aria-label={`Download MP3 for ${track.title}`}
                        >
                          MP3
                        </button>
                        <button
                          className="abw-btn abw-btn--ghost abw-btn--xs"
                          disabled={!track.zipAssetId}
                          onClick={() => handleDownload(track.id, 'zip')}
                          aria-label={`Download stems ZIP for ${track.title}`}
                        >
                          ZIP (stems)
                        </button>
                        <button
                          className="abw-btn abw-btn--ghost abw-btn--xs abw-btn--destructive"
                          onClick={() => void handleDelete(track.id)}
                          aria-label={`Delete ${track.title}`}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
