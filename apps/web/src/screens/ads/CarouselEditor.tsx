// apps/web/src/screens/ads/CarouselEditor.tsx — multi-card carousel composer.
//
// 2-10 cards. All cards share the same aspect ratio (Meta requirement).
// Each card has its own background image + headline + description. The
// shared primary text and CTA live at the carousel level.
//
// Render flow:
//   user fills cards → clicks Render →
//   for each card: composite canvas → blob → upload (multipart) →
//   server collects all card assets in extra.cards[].assetId →
//   slop blocker runs against all cards' headlines + descriptions
import { useEffect, useState } from 'react';
import { apiFetch, apiFetchForm, ApiError } from '../../lib/api';
import { useProjectStore } from '../../lib/store/projectStore';
import { CopyFieldWithCounter } from '../../components/CopyFieldWithCounter';
import { PlatformMediaPicker, type LibraryAsset } from '../../layout/LeftPanel/PlatformMediaPicker';
import type { AdAspect, AdCreative, AdPlacement } from '../AdsStudioScreen';

interface Card {
  headline:    string;
  description: string;
  bgUrl?:      string;
  assetId?:    string;
}

interface Props {
  ad:      AdCreative | null;
  onSaved: () => void;
  onClose: () => void;
}

const PLACEMENT_LIMITS: Record<AdPlacement, { primary: number; headline: number | null; description: number | null }> = {
  feed:        { primary: 125, headline: 27, description: 25 },
  stories:     { primary: 125, headline: 40, description: null },
  reels:       { primary: 125, headline: 40, description: null },
  marketplace: { primary: 125, headline: 27, description: 25 },
};

export function CarouselEditor({ ad, onSaved, onClose }: Props) {
  const currentProject = useProjectStore((s) => s.projects[s.currentProjectId]);

  const [aspect, setAspect]         = useState<AdAspect>(ad?.aspectRatio ?? '1:1');
  const [placement, setPlacement]   = useState<AdPlacement>(ad?.placement ?? 'feed');
  const [primaryText, setPrimaryText] = useState(ad?.primaryText ?? '');
  const [callToAction, setCTA]      = useState(ad?.callToAction ?? 'Learn More');
  const [cards, setCards]           = useState<Card[]>(
    ((ad?.extra as { cards?: Card[] } | undefined)?.cards) ?? [
      { headline: '', description: '' },
      { headline: '', description: '' },
      { headline: '', description: '' },
    ],
  );
  const [pickerForIdx, setPickerForIdx] = useState<number | null>(null);
  const [busy, setBusy]             = useState(false);
  const [err,  setErr]              = useState<string | null>(null);

  useEffect(() => {
    setAspect(ad?.aspectRatio ?? '1:1');
    setPlacement(ad?.placement ?? 'feed');
    setPrimaryText(ad?.primaryText ?? '');
    setCTA(ad?.callToAction ?? 'Learn More');
    setCards(((ad?.extra as { cards?: Card[] } | undefined)?.cards) ?? [
      { headline: '', description: '' },
      { headline: '', description: '' },
      { headline: '', description: '' },
    ]);
  }, [ad?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const limits = PLACEMENT_LIMITS[placement];

  function updateCard(idx: number, patch: Partial<Card>) {
    setCards((prev) => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }
  function addCard() {
    if (cards.length >= 10) return;
    setCards((p) => [...p, { headline: '', description: '' }]);
  }
  function removeCard(idx: number) {
    if (cards.length <= 2) return;
    setCards((p) => p.filter((_, i) => i !== idx));
  }
  function pickFromLibrary(idx: number, asset: LibraryAsset) {
    if (!asset.mimeType.startsWith('image/')) { setErr('Image only'); return; }
    updateCard(idx, { bgUrl: asset.url, assetId: asset.id });
    setPickerForIdx(null);
  }

  async function handleSave() {
    // Tenant-scoped (no project) carousels are supported by the backend —
    // ad_creatives.project_id is nullable. Only block when every card is empty.
    if (cards.every((c) => !c.headline && !c.bgUrl)) {
      setErr('Fill in at least one card first.');
      return;
    }
    setBusy(true); setErr(null);
    try {
      let id = ad?.id;
      if (!id) {
        const res = await apiFetch<{ ad: { id: string } }>('/api/ads', {
          method: 'POST',
          body: JSON.stringify({
            projectId: currentProject?.id ?? null,
            kind: 'carousel',
            placement,
            aspectRatio: aspect,
            headline: '', primaryText, description: '',
            callToAction,
            cards: cards.map((c) => ({ headline: c.headline, description: c.description, assetId: c.assetId })),
          }),
        });
        id = res.ad.id;
      } else {
        await apiFetch(`/api/ads/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            placement, aspectRatio: aspect, primaryText, callToAction,
            cards: cards.map((c) => ({ headline: c.headline, description: c.description, assetId: c.assetId })),
          }),
        });
      }

      // Render finalisation: pick the first card's asset as the carousel's
      // representative thumbnail. Carousel cards each carry their own assetId
      // in the extra.cards array.
      const firstWithAsset = cards.find((c) => c.bgUrl);
      if (firstWithAsset?.bgUrl) {
        const blob = await fetch(firstWithAsset.bgUrl).then((r) => r.blob());
        const form = new FormData();
        form.append('file', blob, `carousel-${id}.png`);
        await apiFetchForm(`/api/ads/${id}/render`, form);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <ToggleGroup label="Aspect" value={aspect} options={['1:1', '4:5']} onChange={(v) => setAspect(v as AdAspect)} />
        <ToggleGroup label="Placement" value={placement} options={['feed', 'marketplace', 'stories', 'reels']} onChange={(v) => setPlacement(v as AdPlacement)} />
        <span style={{ alignSelf: 'flex-end', fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>
          Carousels share aspect across all cards (Meta requirement).
        </span>
      </div>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <CopyFieldWithCounter
          label="Primary text (shared across all cards)"
          value={primaryText}
          onChange={setPrimaryText}
          limit={limits.primary}
          multiline
          rows={2}
        />
        <CopyFieldWithCounter
          label="Call to action (shared)"
          value={callToAction}
          onChange={setCTA}
          limit={null}
          placeholder="Shop now, Learn more, etc."
        />
      </div>

      <h3 style={{ margin: '0 0 var(--space-2)', fontSize: '0.8125rem', fontWeight: 600 }}>
        Cards · {cards.length} (2-10)
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-3)' }}>
        {cards.map((card, idx) => (
          <div key={idx} style={{
            border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-card)',
            padding: 'var(--space-2)',
            background: 'var(--surface-base)',
          }}>
            <div style={{
              aspectRatio: aspect === '4:5' ? '4/5' : '1/1',
              background: card.bgUrl ? `url(${card.bgUrl}) center/cover` : 'var(--bg-subtle)',
              borderRadius: 'var(--radius-field)',
              marginBottom: 'var(--space-2)',
              cursor: 'pointer',
              border: '1px dashed var(--border-base)',
              display: 'flex', alignItems: 'flex-end', padding: 'var(--space-1)',
              color: card.bgUrl ? '#fff' : 'var(--text-tertiary)',
              fontSize: '0.6875rem', textShadow: card.bgUrl ? '0 1px 2px rgba(0,0,0,0.6)' : 'none',
            }} onClick={() => setPickerForIdx(idx)}>
              {card.bgUrl ? card.headline : 'Click to pick image'}
            </div>

            {pickerForIdx === idx && (
              <div style={{
                marginBottom: 'var(--space-2)', padding: 'var(--space-2)',
                border: '1px solid var(--border-base)', borderRadius: 'var(--radius-card)',
                background: 'var(--bg-subtle)',
              }}>
                <PlatformMediaPicker onPick={(a) => pickFromLibrary(idx, a)} />
              </div>
            )}

            <CopyFieldWithCounter
              label={`Card ${idx + 1} headline`}
              value={card.headline}
              onChange={(v) => updateCard(idx, { headline: v })}
              limit={limits.headline}
              placeholder="Specific claim"
            />
            <CopyFieldWithCounter
              label="Description"
              value={card.description}
              onChange={(v) => updateCard(idx, { description: v })}
              limit={limits.description}
              placeholder="Optional detail"
            />
            <button onClick={() => removeCard(idx)} disabled={cards.length <= 2} style={{
              width: '100%', padding: '4px', fontSize: '0.6875rem',
              border: '1px solid var(--border-base)',
              borderRadius: 'var(--radius-field)',
              background: 'transparent',
              color: cards.length <= 2 ? 'var(--text-tertiary)' : 'var(--color-error)',
              cursor: cards.length <= 2 ? 'default' : 'pointer',
            }}>
              Remove
            </button>
          </div>
        ))}

        {cards.length < 10 && (
          <button onClick={addCard} style={{
            border: '2px dashed var(--border-base)',
            borderRadius: 'var(--radius-card)',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            fontSize: '0.875rem', fontWeight: 500,
          }}>
            + Add card ({10 - cards.length} more allowed)
          </button>
        )}
      </div>

      {err && (
        <div role="alert" style={{
          marginTop: 'var(--space-3)', padding: 'var(--space-2)',
          background: 'var(--color-error-bg)', color: 'var(--color-error)',
          borderRadius: 'var(--radius-card)', fontSize: '0.8125rem',
        }}>{err}</div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <button onClick={() => void handleSave()} disabled={busy} style={{
          flex: 1, padding: 'var(--space-2)',
          background: 'var(--accent-500)', color: '#fff', border: 'none',
          borderRadius: 'var(--radius-button)',
          cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
          fontWeight: 600, fontSize: '0.875rem',
        }}>
          {busy ? 'Saving…' : 'Save carousel'}
        </button>
        <button onClick={onClose} style={{
          padding: 'var(--space-2) var(--space-3)',
          border: '1px solid var(--border-base)',
          borderRadius: 'var(--radius-field)',
          background: 'var(--bg-subtle)',
          cursor: 'pointer', fontSize: '0.75rem',
        }}>Close</button>
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
