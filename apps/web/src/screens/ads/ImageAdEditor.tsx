// apps/web/src/screens/ads/ImageAdEditor.tsx — image ad composer.
//
// Premium-quality bar, baked in (matches the plan):
//   1. Niche-aware copy seeds (server-side via /api/ads/seed)
//   2. Framework picker — 3 buttons that re-seed via the same endpoint
//   3. Slop blocker on Render — server returns 422 with flags, UI surfaces them
//   4. Visual hierarchy linter — runs on the canvas before render
//   5. Auto A/B variants — populated server-side, the SPA composites them
//
// Render flow:
//   user fills copy → clicks Render →
//   client-side <canvas> draws bg + headline + primary text →
//   canvas.toBlob('image/png') → POST /api/ads/:id/render multipart →
//   server runs slop blocker, refuses with 422 if it fires →
//   on success: returns ad + asset + variant copies →
//   for each variant: re-render canvas with that copy + POST again silently
//
// All compositing happens here on the client. No `sharp` server-side dep.
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, apiFetchForm, ApiError } from '../../lib/api';
import { useProjectStore } from '../../lib/store/projectStore';
import { useRunStore } from '../../lib/store/runStore';
import { Toggle } from '@abw/ui';
import { CopyFieldWithCounter } from '../../components/CopyFieldWithCounter';
import { SafeZoneOverlay } from '../../components/SafeZoneOverlay';
import { PlatformMediaPicker, type LibraryAsset } from '../../layout/LeftPanel/PlatformMediaPicker';
import { AiTextEditModal } from './AiTextEditModal';
import type { AdAspect, AdCreative, AdPlacement } from '../AdsStudioScreen';

type Framework = 'specific-value-prop' | 'pattern-interrupt' | 'before-after';

interface Props {
  ad:      AdCreative | null;
  onSaved: () => void;
  onClose: () => void;
}

const ASPECT_DIMS: Record<AdAspect, { w: number; h: number }> = {
  '1:1':  { w: 1080, h: 1080 },
  '4:5':  { w: 1080, h: 1350 },
  '9:16': { w: 1080, h: 1920 },
};

const PLACEMENT_LIMITS: Record<AdPlacement, { primary: number; headline: number | null; description: number | null }> = {
  feed:        { primary: 125, headline: 27, description: 25 },
  stories:     { primary: 125, headline: 40, description: null },
  reels:       { primary: 125, headline: 40, description: null },
  marketplace: { primary: 125, headline: 27, description: 25 },
};

const FRAMEWORKS: { id: Framework; label: string; hint: string }[] = [
  { id: 'specific-value-prop', label: 'Specific value prop', hint: '"{benefit} for {audience}"' },
  { id: 'pattern-interrupt',   label: 'Pattern interrupt',   hint: 'Open with a number, place, or unexpected fact' },
  { id: 'before-after',        label: 'Before / after',      hint: '"{old state} → {new state}"' },
];

interface SlopMatch { phrase: string; replacement: string; fields: string[]; }

export function ImageAdEditor({ ad, onSaved, onClose }: Props) {
  const currentProject = useProjectStore((s) => s.projects[s.currentProjectId]);
  const { aiEditEnabled, setAiEditEnabled } = useRunStore();
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [bgUrl, setBgUrl]            = useState<string | null>(ad?.assetUrl ?? null);
  const [headline, setHeadline]      = useState(ad?.headline ?? '');
  const [primaryText, setPrimaryText] = useState(ad?.primaryText ?? '');
  const [description, setDescription] = useState(ad?.description ?? '');
  const [callToAction, setCTA]       = useState(ad?.callToAction ?? 'Learn More');
  const [placement, setPlacement]    = useState<AdPlacement>(ad?.placement ?? 'feed');
  const [aspect, setAspect]          = useState<AdAspect>(ad?.aspectRatio ?? '1:1');
  const [framework, setFramework]    = useState<Framework>('specific-value-prop');
  const [bgPickerOpen, setBgPicker]  = useState(false);

  const [busy, setBusy]              = useState(false);
  const [err,  setErr]               = useState<string | null>(null);
  const [slop, setSlop]              = useState<SlopMatch[] | null>(null);
  const [variants, setVariants]      = useState<{ headline: string; primary: string }[]>([]);
  const [hierarchyWarn, setHierWarn] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Reset state when switching ads
  useEffect(() => {
    setBgUrl(ad?.assetUrl ?? null);
    setHeadline(ad?.headline ?? '');
    setPrimaryText(ad?.primaryText ?? '');
    setDescription(ad?.description ?? '');
    setCTA(ad?.callToAction ?? 'Learn More');
    setPlacement(ad?.placement ?? 'feed');
    setAspect(ad?.aspectRatio ?? '1:1');
    setSlop(null); setErr(null); setVariants([]); setHierWarn(null);
  }, [ad?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const limits = PLACEMENT_LIMITS[placement];
  const dims   = ASPECT_DIMS[aspect];

  // ── Background sourcing ────────────────────────────────────────────────────
  async function pickFromLibrary(asset: LibraryAsset) {
    if (!asset.mimeType.startsWith('image/')) {
      setErr('Pick an image — videos go to the Video tab');
      return;
    }
    setBgUrl(asset.url);
    setBgPicker(false);
  }

  async function uploadLocal(file: File) {
    if (!file.type.startsWith('image/')) { setErr('Image only'); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetchForm<{ asset: { url: string } }>(
        `/api/assets/upload?projectId=${currentProject?.id ?? ''}`, form,
      );
      setBgUrl(res.asset.url);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function generateBg() {
    if (!currentProject) { setErr('Pick a project first to generate a background'); return; }
    setBusy(true);
    try {
      // Use the existing chat surface to fire gen_image. The image goes into
      // /images/<filename> in the workspace + lands as an asset row.
      const prompt = `${aspect} hero image for an ad, ${placement} placement. ${primaryText || headline || 'Premium product photography. Soft natural lighting. Single subject in focus.'}. Avoid text in the image — text is composed over the top.`;
      const res = await apiFetch<{ asset: { url: string } }>('/api/ads/gen-bg', {
        method: 'POST',
        body: JSON.stringify({ prompt, projectId: currentProject.id, aspect }),
      }).catch(() => null);
      if (res?.asset?.url) setBgUrl(res.asset.url);
      else setErr('Background generation is wired to the chat agent — open chat and ask for an image, then pick it from Library.');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  // ── Framework picker → re-seeds copy from server ──────────────────────────
  async function seedFromFramework(fw: Framework) {
    setFramework(fw);
    try {
      // Pull niche from memory if the planner has set it. The frontend
      // store doesn't surface project.config — the planner's last-niche
      // hint is currently kept on memory.recentSummaries elsewhere; for
      // now just send the framework and let the server use the fallback
      // pattern set when niche is missing.
      const niche = (currentProject?.memory as { lastPlannedNiche?: string } | undefined)?.lastPlannedNiche;
      const qs = niche ? `&niche=${encodeURIComponent(niche)}` : '';
      const res = await apiFetch<{ pattern: { headline: string; primary: string } }>(
        `/api/ads/seed?framework=${fw}${qs}`,
      );
      setHeadline(res.pattern.headline);
      setPrimaryText(res.pattern.primary);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to load framework');
    }
  }

  // ── Visual hierarchy linter (runs on canvas, gates render with a warning) ─
  // Cheap heuristic — count how many distinct visual elements we're drawing.
  // This is non-blocking: render proceeds even if the lint flags an issue,
  // we just show a warning panel above the button.
  function lintHierarchy() {
    const competing: string[] = [];
    if (headline) competing.push('headline');
    if (primaryText && primaryText.length > 60) competing.push('long primary text');
    if (description) competing.push('description');
    if (callToAction && callToAction !== 'Learn More') competing.push('custom CTA');
    if (competing.length >= 4) {
      setHierWarn(`${competing.length} competing text elements detected. Consider removing the description or shortening the primary text — single dominant headline rule.`);
    } else {
      setHierWarn(null);
    }
  }

  useEffect(() => { lintHierarchy(); }, [headline, primaryText, description, callToAction]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas draw ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = dims.w;
    canvas.height = dims.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0e2c2b';  // SignalPoint deep teal as a forgiving default
    ctx.fillRect(0, 0, dims.w, dims.h);

    if (bgUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // Cover-style fill
        const imgRatio    = img.width / img.height;
        const canvasRatio = dims.w / dims.h;
        let drawW: number, drawH: number, drawX: number, drawY: number;
        if (imgRatio > canvasRatio) {
          drawH = dims.h; drawW = dims.h * imgRatio; drawX = (dims.w - drawW) / 2; drawY = 0;
        } else {
          drawW = dims.w; drawH = dims.w / imgRatio; drawX = 0; drawY = (dims.h - drawH) / 2;
        }
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        drawText(ctx);
      };
      img.onerror = () => drawText(ctx);
      img.src = bgUrl;
    } else {
      drawText(ctx);
    }
  }, [bgUrl, headline, primaryText, description, callToAction, aspect]); // eslint-disable-line react-hooks/exhaustive-deps

  function drawText(ctx: CanvasRenderingContext2D) {
    // Bottom-anchored copy block with a translucent dark gradient for legibility
    const blockHeight = Math.round(dims.h * 0.35);
    const grad = ctx.createLinearGradient(0, dims.h - blockHeight, 0, dims.h);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, dims.h - blockHeight, dims.w, blockHeight);

    // Headline — large, bold, white
    ctx.fillStyle = '#fff';
    const headlineSize = Math.round(dims.w * 0.058);
    ctx.font = `700 ${headlineSize}px ui-sans-serif, system-ui, sans-serif`;
    const padX = Math.round(dims.w * 0.06);
    wrapText(ctx, headline, padX, dims.h - blockHeight + Math.round(blockHeight * 0.35), dims.w - padX * 2, headlineSize * 1.15);

    // Primary text — smaller, lighter
    const primarySize = Math.round(headlineSize * 0.55);
    ctx.font = `500 ${primarySize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    wrapText(ctx, primaryText, padX, dims.h - Math.round(blockHeight * 0.35), dims.w - padX * 2, primarySize * 1.3);

    // CTA pill — bottom-right
    if (callToAction) {
      ctx.fillStyle = '#1B8E8C';
      const pillH = Math.round(headlineSize * 0.9);
      const pillPadX = Math.round(headlineSize * 0.4);
      ctx.font = `600 ${Math.round(headlineSize * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
      const tw = ctx.measureText(callToAction).width;
      const pillW = tw + pillPadX * 2;
      const pillX = dims.w - padX - pillW;
      const pillY = dims.h - padX - pillH;
      roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(callToAction, pillX + pillPadX, pillY + pillH / 2);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // ── Render (Save + composite + upload) ────────────────────────────────────
  async function handleRender(force = false) {
    // Tenant-scoped ads (no project) are explicitly supported by the
    // backend — projectId is nullable on ad_creatives. Only block when
    // there's literally nothing to render (no copy AND no background).
    if (!headline.trim() && !primaryText.trim() && !bgUrl) {
      setErr('Add a headline, primary text, or background image first.');
      return;
    }
    setBusy(true); setErr(null); setSlop(null);

    try {
      // Step 1 — upsert ad
      let id = ad?.id;
      if (!id) {
        const res = await apiFetch<{ ad: { id: string } }>('/api/ads', {
          method: 'POST',
          body: JSON.stringify({
            projectId: currentProject?.id ?? null,
            kind: 'image',
            placement,
            aspectRatio: aspect,
            headline,
            primaryText,
            description,
            callToAction,
          }),
        });
        id = res.ad.id;
      } else {
        await apiFetch(`/api/ads/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ placement, aspectRatio: aspect, headline, primaryText, description, callToAction }),
        });
      }

      // Step 2 — composite canvas → blob
      const canvas = canvasRef.current!;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
      });

      // Step 3 — POST /api/ads/:id/render
      const form = new FormData();
      form.append('file', blob, `ad-${id}.png`);
      if (force) form.append('force', '1');
      const renderRes = await apiFetchForm<{ ad: AdCreative; asset: { url: string }; variants?: { headline: string; primary: string }[] }>(
        `/api/ads/${id}/render`, form,
      );
      setVariants(renderRes.variants ?? []);
      onSaved();
    } catch (e) {
      // Slop blocker → 422 with flags
      if (e instanceof ApiError && e.status === 422) {
        try {
          const detail = JSON.parse((e.message ?? '').replace(/^.*?{/, '{')) as { slopFlags?: SlopMatch[] };
          setSlop(detail.slopFlags ?? []);
        } catch { setErr(e.message); }
      } else {
        setErr(e instanceof ApiError ? e.message : 'Render failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Toolbar: aspect, placement, framework picker */}
      <div style={{
        display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap',
        padding: 'var(--space-2) 0', marginBottom: 'var(--space-3)',
      }}>
        <ToggleGroup label="Aspect" value={aspect} options={['1:1', '4:5', '9:16']} onChange={(v) => setAspect(v as AdAspect)} />
        <ToggleGroup label="Placement" value={placement} options={['feed', 'stories', 'reels', 'marketplace']} onChange={(v) => setPlacement(v as AdPlacement)} />
      </div>

      {/* AI text-edit toggle (off by default, ~$0.08/click) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-1) var(--space-2)',
        marginBottom: 'var(--space-3)',
        border: '1px solid var(--border-base)',
        borderRadius: 'var(--radius-field)',
        background: 'var(--bg-subtle)',
      }}>
        <Toggle
          size="sm"
          checked={aiEditEnabled}
          onChange={setAiEditEnabled}
          ariaLabel="Toggle AI text edit"
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem' }}>
              <span aria-hidden>✦</span>
              AI text edit
            </span>
          }
        />
        <span style={{ fontSize: '0.625rem', color: 'var(--text-tertiary)', flex: 1 }}>
          Inpaints replacement text via Replicate Ideogram v2 — ~$0.08/edit. Off by default. Manual canvas always available.
        </span>
        <button
          onClick={() => bgUrl && setAiModalOpen(true)}
          disabled={!aiEditEnabled || !bgUrl}
          title={!bgUrl ? 'Pick a background first' : !aiEditEnabled ? 'Toggle AI text edit on first' : 'Replace text on the background image'}
          style={{
            padding: '4px 8px', fontSize: '0.6875rem',
            background: aiEditEnabled && bgUrl ? 'var(--accent-500)' : 'var(--bg-subtle)',
            color: aiEditEnabled && bgUrl ? '#fff' : 'var(--text-tertiary)',
            border: '1px solid var(--border-base)', borderRadius: 'var(--radius-field)',
            cursor: aiEditEnabled && bgUrl ? 'pointer' : 'default',
            fontWeight: 600,
          }}
        >
          Edit text on image
        </button>
      </div>

      <div role="group" aria-label="Direct-response framework" style={{
        display: 'flex', gap: 4, marginBottom: 'var(--space-3)',
      }}>
        {FRAMEWORKS.map((f) => (
          <button
            key={f.id}
            onClick={() => void seedFromFramework(f.id)}
            aria-pressed={framework === f.id}
            title={f.hint}
            style={{
              flex: 1,
              padding: 'var(--space-2)',
              border: `1px solid ${framework === f.id ? 'var(--accent-500)' : 'var(--border-base)'}`,
              borderRadius: 'var(--radius-field)',
              background: framework === f.id ? 'var(--accent-50)' : 'var(--surface-base)',
              color: framework === f.id ? 'var(--accent-600)' : 'var(--text-primary)',
              cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
              textAlign: 'left',
            }}
          >
            <div>{f.label}</div>
            <div style={{ fontSize: '0.625rem', opacity: 0.8, fontWeight: 400, marginTop: 2 }}>
              {f.hint}
            </div>
          </button>
        ))}
      </div>

      {/* Two-column: canvas left, copy fields right */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
        <div>
          {/* Background source row */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <button
              onClick={() => setBgPicker((v) => !v)}
              style={btnStyle()}
              type="button"
            >
              {bgUrl ? '↺ Change background' : 'Pick background'}
            </button>
            <label style={{ ...btnStyle(), padding: 0, position: 'relative' }}>
              <span style={{ padding: 'var(--space-1) var(--space-2)' }}>↑ Upload</span>
              <input
                type="file"
                accept="image/*"
                style={{
                  position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer',
                }}
                onChange={(e) => e.target.files?.[0] && void uploadLocal(e.target.files[0])}
              />
            </label>
            <button
              onClick={() => void generateBg()}
              style={btnStyle()}
              type="button"
              disabled={busy}
            >
              ✦ Generate
            </button>
          </div>

          {bgPickerOpen && (
            <div style={{
              marginBottom: 'var(--space-2)',
              padding: 'var(--space-2)',
              border: '1px solid var(--border-base)',
              borderRadius: 'var(--radius-card)',
              background: 'var(--surface-base)',
            }}>
              <PlatformMediaPicker onPick={(a) => void pickFromLibrary(a)} />
            </div>
          )}

          {/* Canvas preview */}
          <div style={{ position: 'relative', maxWidth: '100%' }}>
            <canvas
              ref={canvasRef}
              style={{
                width: '100%', height: 'auto',
                background: '#0e2c2b',
                borderRadius: 'var(--radius-card)',
                border: '1px solid var(--border-base)',
              }}
            />
            <SafeZoneOverlay
              placement={placement}
              aspectRatio={aspect}
              canvasHeight={canvasRef.current?.getBoundingClientRect().height ?? 0}
            />
          </div>
        </div>

        {/* Copy fields */}
        <div>
          <CopyFieldWithCounter
            label="Headline"
            value={headline}
            onChange={setHeadline}
            limit={limits.headline}
            placeholder="A concrete, specific claim"
            hint="Single dominant element. Use names, numbers, or unexpected facts."
          />
          <CopyFieldWithCounter
            label="Primary text"
            value={primaryText}
            onChange={setPrimaryText}
            limit={limits.primary}
            placeholder="Specific outcome for a specific customer"
            hint="One sentence. One outcome. One next step."
            multiline
            rows={3}
          />
          {limits.description !== null && (
            <CopyFieldWithCounter
              label="Description"
              value={description}
              onChange={setDescription}
              limit={limits.description}
              placeholder="Optional secondary line"
            />
          )}
          <CopyFieldWithCounter
            label="Call to action"
            value={callToAction}
            onChange={setCTA}
            limit={null}
            placeholder="Book a tour, See pricing, etc."
            hint='Avoid "Learn more" or "Click here" — name the actual action.'
          />

          {/* Slop blocker output */}
          {slop && slop.length > 0 && (
            <div role="alert" style={{
              padding: 'var(--space-3)', marginBottom: 'var(--space-3)',
              background: 'var(--color-error-bg)',
              color: 'var(--color-error)',
              border: '1px solid var(--color-error)',
              borderRadius: 'var(--radius-card)',
              fontSize: '0.8125rem',
            }}>
              <strong>Generic-AI phrases detected.</strong>
              <ul style={{ margin: 'var(--space-2) 0 0 var(--space-3)' }}>
                {slop.map((s, i) => (
                  <li key={i}>
                    <code>"{s.phrase}"</code> in {s.fields.join(', ')} — {s.replacement}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => void handleRender(true)}
                style={{
                  marginTop: 'var(--space-2)',
                  padding: 'var(--space-1) var(--space-2)',
                  background: 'var(--color-error)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-button)',
                  fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Render anyway
              </button>
            </div>
          )}

          {/* Hierarchy linter warning */}
          {hierarchyWarn && (
            <div role="alert" style={{
              padding: 'var(--space-2)', marginBottom: 'var(--space-3)',
              background: 'var(--surface-warning, #fef3c7)',
              color: '#92400e',
              border: '1px solid #facc15',
              borderRadius: 'var(--radius-card)',
              fontSize: '0.75rem',
            }}>
              ⚠ {hierarchyWarn}
            </div>
          )}

          {err && (
            <div role="alert" style={{
              padding: 'var(--space-2)', marginBottom: 'var(--space-3)',
              background: 'var(--color-error-bg)', color: 'var(--color-error)',
              borderRadius: 'var(--radius-card)', fontSize: '0.8125rem',
            }}>{err}</div>
          )}

          {/* Action row */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button
              onClick={() => void handleRender(false)}
              disabled={busy}
              style={{
                flex: 1, padding: 'var(--space-2)',
                background: 'var(--accent-500)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-button)',
                cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
                fontWeight: 600, fontSize: '0.875rem',
              }}
            >
              {busy ? 'Rendering…' : ad?.assetId ? 'Re-render' : 'Render ad'}
            </button>
            <button
              onClick={onClose}
              style={{ ...btnStyle(), padding: 'var(--space-2) var(--space-3)' }}
              type="button"
            >
              Close
            </button>
          </div>

          {/* Variants — auto-generated A/B copies for the user to pick from */}
          {variants.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <h4 style={{ margin: '0 0 var(--space-2)', fontSize: '0.8125rem', fontWeight: 600 }}>
                A/B variants (free — try a different angle)
              </h4>
              {variants.map((v, i) => (
                <button
                  key={i}
                  onClick={() => { setHeadline(v.headline); setPrimaryText(v.primary); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: 'var(--space-2)', marginBottom: 4,
                    border: '1px solid var(--border-base)',
                    borderRadius: 'var(--radius-field)',
                    background: 'var(--surface-base)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{v.headline}</div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', marginTop: 2 }}>{v.primary}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {aiModalOpen && bgUrl && (
        <AiTextEditModal
          imageUrl={bgUrl}
          projectId={currentProject?.id ?? null}
          onComplete={(newUrl) => {
            setBgUrl(newUrl);
            setAiModalOpen(false);
          }}
          onCancel={() => setAiModalOpen(false)}
        />
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
            <button
              key={o}
              onClick={() => onChange(o)}
              aria-pressed={active}
              style={{
                padding: '4px 10px',
                border: `1px solid ${active ? 'var(--accent-500)' : 'var(--border-base)'}`,
                borderRadius: 'var(--radius-field)',
                background: active ? 'var(--accent-50)' : 'var(--bg-subtle)',
                color: active ? 'var(--accent-600)' : 'var(--text-secondary)',
                fontSize: '0.6875rem', fontWeight: active ? 600 : 500,
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {o}
            </button>
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

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, yy);
      line = words[n] + ' ';
      yy += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, yy);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
