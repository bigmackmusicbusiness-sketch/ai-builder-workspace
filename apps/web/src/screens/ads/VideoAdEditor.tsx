// apps/web/src/screens/ads/VideoAdEditor.tsx — video ad composer.
//
// Simpler than the image editor: the user picks a base video (Library or
// upload), fills the same copy fields, and the SPA produces a thumbnail
// preview + a copy.md export. Server-side video compositing (text overlay
// burned in via ffmpeg) is deferred — this v1 ships a "video-as-attachment +
// copy.md" workflow which is what most paid ad operators actually do
// (text in the ad goes into Meta Ads Manager fields, not the video itself).
//
// What we DO enforce:
//   • Duration cap per placement (Reels 90s, Stories 120s, Feed effectively
//     unlimited but warn over 60s)
//   • Slop blocker on copy fields (server-side via /api/ads/:id/render)
//   • Aspect ratio validation (9:16 default for Reels/Stories, 1:1 for Feed)
import { useEffect, useRef, useState } from 'react';
import { apiFetch, apiFetchForm, ApiError } from '../../lib/api';
import { useProjectStore } from '../../lib/store/projectStore';
import { CopyFieldWithCounter } from '../../components/CopyFieldWithCounter';
import { PlatformMediaPicker, type LibraryAsset } from '../../layout/LeftPanel/PlatformMediaPicker';
import type { AdAspect, AdCreative, AdPlacement } from '../AdsStudioScreen';

interface Props {
  ad:      AdCreative | null;
  onSaved: () => void;
  onClose: () => void;
}

const DURATION_CAPS: Record<AdPlacement, { ideal: number; max: number }> = {
  feed:        { ideal: 60,  max: 14460 },
  stories:     { ideal: 60,  max: 120 },
  reels:       { ideal: 30,  max: 90 },
  marketplace: { ideal: 60,  max: 14460 },
};

const PLACEMENT_LIMITS: Record<AdPlacement, { primary: number; headline: number | null; description: number | null }> = {
  feed:        { primary: 125, headline: 27, description: 25 },
  stories:     { primary: 125, headline: 40, description: null },
  reels:       { primary: 125, headline: 40, description: null },
  marketplace: { primary: 125, headline: 27, description: 25 },
};

export function VideoAdEditor({ ad, onSaved, onClose }: Props) {
  const currentProject = useProjectStore((s) => s.projects[s.currentProjectId]);
  const [videoUrl, setVideoUrl]      = useState<string | null>(ad?.assetMime?.startsWith('video/') ? ad?.assetUrl : null);
  const [headline, setHeadline]      = useState(ad?.headline ?? '');
  const [primaryText, setPrimaryText] = useState(ad?.primaryText ?? '');
  const [description, setDescription] = useState(ad?.description ?? '');
  const [callToAction, setCTA]       = useState(ad?.callToAction ?? 'Learn More');
  const [placement, setPlacement]    = useState<AdPlacement>(ad?.placement ?? 'reels');
  const [aspect, setAspect]          = useState<AdAspect>(ad?.aspectRatio ?? '9:16');
  const [duration, setDuration]      = useState<number>(0);
  const [bgPickerOpen, setBgPicker]  = useState(false);
  const [busy, setBusy]              = useState(false);
  const [err, setErr]                = useState<string | null>(null);
  const [variants, setVariants]      = useState<{ headline: string; primary: string }[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Reset on ad switch
  useEffect(() => {
    setVideoUrl(ad?.assetMime?.startsWith('video/') ? ad?.assetUrl ?? null : null);
    setHeadline(ad?.headline ?? '');
    setPrimaryText(ad?.primaryText ?? '');
    setDescription(ad?.description ?? '');
    setCTA(ad?.callToAction ?? 'Learn More');
    setPlacement(ad?.placement ?? 'reels');
    setAspect(ad?.aspectRatio ?? '9:16');
    setVariants([]); setErr(null);
  }, [ad?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const limits = PLACEMENT_LIMITS[placement];
  const cap    = DURATION_CAPS[placement];
  const overIdeal = duration > 0 && duration > cap.ideal;
  const overMax   = duration > 0 && duration > cap.max;

  function pickFromLibrary(asset: LibraryAsset) {
    if (!asset.mimeType.startsWith('video/')) {
      setErr('Pick a video — images go to the Image tab');
      return;
    }
    setVideoUrl(asset.url);
    setBgPicker(false);
  }

  async function uploadLocal(file: File) {
    if (!file.type.startsWith('video/')) { setErr('Video only'); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetchForm<{ asset: { url: string } }>(
        `/api/assets/upload?projectId=${currentProject?.id ?? ''}`, form,
      );
      setVideoUrl(res.asset.url);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRender(force = false) {
    if (!videoUrl) { setErr('Pick or upload a video first'); return; }
    if (overMax) { setErr(`${cap.max}s max for ${placement} — trim the video first`); return; }
    setBusy(true); setErr(null);

    try {
      // 1. Upsert ad row
      let id = ad?.id;
      if (!id) {
        const res = await apiFetch<{ ad: { id: string } }>('/api/ads', {
          method: 'POST',
          body: JSON.stringify({
            projectId: currentProject?.id ?? null,
            kind: 'video',
            placement, aspectRatio: aspect,
            headline, primaryText, description, callToAction,
          }),
        });
        id = res.ad.id;
      } else {
        await apiFetch(`/api/ads/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ placement, aspectRatio: aspect, headline, primaryText, description, callToAction }),
        });
      }

      // 2. Fetch the video bytes and re-upload via the render endpoint so
      //    the slop blocker has a chance to gate.
      const videoBytes = await fetch(videoUrl).then((r) => r.blob());
      const form = new FormData();
      form.append('file', videoBytes, `ad-${id}.mp4`);
      if (force) form.append('force', '1');

      const r = await apiFetchForm<{ ad: AdCreative; variants?: { headline: string; primary: string }[] }>(
        `/api/ads/${id}/render`, form,
      );
      setVariants(r.variants ?? []);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const flags = (e.data?.['slopFlags'] as { phrase: string }[] | undefined) ?? [];
        setErr(`Generic-AI phrases: ${flags.map((s) => s.phrase).join(', ')}. Edit copy and retry, or click Render anyway.`);
      } else {
        setErr(e instanceof ApiError ? e.message : 'Render failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <ToggleGroup label="Aspect" value={aspect} options={['9:16', '4:5', '1:1']} onChange={(v) => setAspect(v as AdAspect)} />
        <ToggleGroup label="Placement" value={placement} options={['reels', 'stories', 'feed', 'marketplace']} onChange={(v) => setPlacement(v as AdPlacement)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <button onClick={() => setBgPicker((v) => !v)} style={btnStyle()} type="button">
              {videoUrl ? '↺ Change video' : 'Pick video'}
            </button>
            <label style={{ ...btnStyle(), padding: 0, position: 'relative' }}>
              <span style={{ padding: 'var(--space-1) var(--space-2)' }}>↑ Upload</span>
              <input type="file" accept="video/*"
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                onChange={(e) => e.target.files?.[0] && void uploadLocal(e.target.files[0])}
              />
            </label>
          </div>

          {bgPickerOpen && (
            <div style={{
              marginBottom: 'var(--space-2)', padding: 'var(--space-2)',
              border: '1px solid var(--border-base)', borderRadius: 'var(--radius-card)',
              background: 'var(--surface-base)',
            }}>
              <PlatformMediaPicker onPick={pickFromLibrary} />
            </div>
          )}

          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              onLoadedMetadata={(e) => setDuration((e.target as HTMLVideoElement).duration)}
              style={{ width: '100%', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-base)' }}
            />
          ) : (
            <div style={{
              aspectRatio: aspect === '9:16' ? '9/16' : aspect === '4:5' ? '4/5' : '1/1',
              background: 'var(--bg-subtle)',
              border: '2px dashed var(--border-base)',
              borderRadius: 'var(--radius-card)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-tertiary)', fontSize: '0.75rem',
            }}>
              Pick or upload a video to preview
            </div>
          )}

          {duration > 0 && (
            <div style={{
              marginTop: 'var(--space-2)', padding: 'var(--space-1) var(--space-2)',
              fontSize: '0.6875rem',
              color: overMax ? 'var(--color-error)' : overIdeal ? '#92400e' : 'var(--text-secondary)',
            }}>
              Duration: {duration.toFixed(1)}s · {placement} ideal ≤ {cap.ideal}s, max {cap.max}s
              {overMax && ' · OVER MAX — must trim'}
              {overIdeal && !overMax && ' · over ideal'}
            </div>
          )}
        </div>

        <div>
          <CopyFieldWithCounter label="Headline" value={headline} onChange={setHeadline} limit={limits.headline}
            placeholder="A concrete, specific claim"
            hint="Be specific. No generic adjectives." />
          <CopyFieldWithCounter label="Primary text" value={primaryText} onChange={setPrimaryText} limit={limits.primary}
            placeholder="One sentence. One outcome. One next step." multiline rows={3} />
          {limits.description !== null && (
            <CopyFieldWithCounter label="Description" value={description} onChange={setDescription} limit={limits.description} />
          )}
          <CopyFieldWithCounter label="Call to action" value={callToAction} onChange={setCTA} limit={null} />

          {err && (
            <div role="alert" style={{
              padding: 'var(--space-2)', marginBottom: 'var(--space-3)',
              background: 'var(--color-error-bg)', color: 'var(--color-error)',
              borderRadius: 'var(--radius-card)', fontSize: '0.75rem',
            }}>{err}</div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button onClick={() => void handleRender(false)} disabled={busy || !videoUrl} style={{
              flex: 1, padding: 'var(--space-2)', background: 'var(--accent-500)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-button)',
              cursor: busy || !videoUrl ? 'default' : 'pointer', opacity: busy || !videoUrl ? 0.6 : 1,
              fontWeight: 600, fontSize: '0.875rem',
            }}>
              {busy ? 'Saving…' : 'Render ad'}
            </button>
            <button onClick={onClose} style={{ ...btnStyle(), padding: 'var(--space-2) var(--space-3)' }} type="button">
              Close
            </button>
          </div>

          {variants.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <h4 style={{ margin: '0 0 var(--space-2)', fontSize: '0.8125rem', fontWeight: 600 }}>
                A/B variants
              </h4>
              {variants.map((v, i) => (
                <button key={i} onClick={() => { setHeadline(v.headline); setPrimaryText(v.primary); }} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: 'var(--space-2)', marginBottom: 4,
                  border: '1px solid var(--border-base)',
                  borderRadius: 'var(--radius-field)',
                  background: 'var(--surface-base)', cursor: 'pointer',
                }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{v.headline}</div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', marginTop: 2 }}>{v.primary}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToggleGroup<T extends string>({
  label, value, options, onChange,
}: {
  label:    string;
  value:    T;
  options:  readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', fontWeight: 600 }}>
        {label}
      </span>
      <div style={{ display: 'flex', gap: 2 }}>
        {options.map((o) => {
          const active = value === o;
          return (
            <button key={o} onClick={() => onChange(o)} aria-pressed={active} style={{
              padding: '4px 10px',
              border: `1px solid ${active ? 'var(--accent-500)' : 'var(--border-base)'}`,
              borderRadius: 'var(--radius-field)',
              background: active ? 'var(--accent-50)' : 'var(--bg-subtle)',
              color: active ? 'var(--accent-600)' : 'var(--text-secondary)',
              fontSize: '0.6875rem', fontWeight: active ? 600 : 500,
              cursor: 'pointer', textTransform: 'capitalize',
            }}>{o}</button>
          );
        })}
      </div>
    </div>
  );
}

function btnStyle() {
  return {
    padding: 'var(--space-1) var(--space-2)',
    border: '1px solid var(--border-base)',
    borderRadius: 'var(--radius-field)',
    background: 'var(--bg-subtle)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 500,
  } as const;
}
