// apps/web/src/screens/AdsStudioScreen.tsx — top-level Ads tab.
//
// Three sub-tabs:
//   • Image    — single image ad (1:1 / 4:5 / 9:16)
//   • Video    — single video ad (9:16 default — Reels)
//   • Carousel — 2-10 cards, all same aspect
//
// Plus a Library panel listing every ad creative the tenant has produced
// so the user can re-edit, duplicate, or pick A/B variants.
//
// The page is the lightweight shell — the heavy editor lives in the
// per-kind sub-screens (./ads/ImageAdEditor.tsx etc).
import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { ImageAdEditor } from './ads/ImageAdEditor';
import { VideoAdEditor } from './ads/VideoAdEditor';
import { CarouselEditor } from './ads/CarouselEditor';

type AdKind = 'image' | 'video' | 'carousel';
export type AdPlacement = 'feed' | 'stories' | 'reels' | 'marketplace';
export type AdAspect    = '1:1' | '4:5' | '9:16';

export interface AdCreative {
  id:           string;
  projectId:    string | null;
  kind:         AdKind;
  placement:    AdPlacement;
  aspectRatio:  AdAspect;
  headline:     string;
  primaryText:  string;
  description:  string;
  callToAction: string;
  assetId:      string | null;
  assetUrl:     string | null;
  assetMime:    string | null;
  projectName:  string | null;
  extra:        Record<string, unknown>;
  updatedAt:    string;
}

export function AdsStudioScreen() {
  const [tab, setTab]               = useState<AdKind>('image');
  const [ads, setAds]               = useState<AdCreative[]>([]);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);

  async function reload() {
    try {
      const res = await apiFetch<{ ads: AdCreative[] }>('/api/ads');
      setAds(res.ads);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load ads');
    }
  }
  useEffect(() => { void reload(); }, []);

  const editing = editingId ? ads.find((a) => a.id === editingId) ?? null : null;
  const filtered = ads.filter((a) => a.kind === tab);

  return (
    <div className="abw-screen">
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Ads Studio</h1>
          <p className="abw-screen__sub">
            Premium ad creatives for Facebook & Instagram. Export → paste into Meta Ads Manager.
          </p>
        </div>
      </div>

      {/* Kind tabs */}
      <div role="tablist" aria-label="Ad kind" style={{
        display: 'flex', gap: 4, marginBottom: 'var(--space-4)',
        borderBottom: '1px solid var(--border-base)',
      }}>
        {(['image', 'video', 'carousel'] as const).map((k) => {
          const active = tab === k;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={active}
              onClick={() => { setTab(k); setEditingId(null); }}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid var(--accent-500)' : '2px solid transparent',
                color: active ? 'var(--accent-600)' : 'var(--text-secondary)',
                fontSize: '0.875rem', fontWeight: active ? 600 : 500,
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {k}
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{
          padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-3)',
          background: 'var(--color-error-bg)', color: 'var(--color-error)',
          borderRadius: 'var(--radius-card)', fontSize: '0.8125rem',
        }}>{error}</div>
      )}

      {/* Editor (left) + Library (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 'var(--space-4)', alignItems: 'start' }}>
        <div>
          {tab === 'image'    && <ImageAdEditor    ad={editing} onSaved={reload} onClose={() => setEditingId(null)} />}
          {tab === 'video'    && <VideoAdEditor    ad={editing} onSaved={reload} onClose={() => setEditingId(null)} />}
          {tab === 'carousel' && <CarouselEditor   ad={editing} onSaved={reload} onClose={() => setEditingId(null)} />}
        </div>

        <aside aria-label="Ad library" style={{
          background: 'var(--surface-base)',
          border: '1px solid var(--border-base)',
          borderRadius: 'var(--radius-card)',
          padding: 'var(--space-3)',
          maxHeight: '70vh', overflowY: 'auto',
        }}>
          <h3 style={{ margin: '0 0 var(--space-2)', fontSize: '0.875rem', fontWeight: 600 }}>
            Library · {filtered.length}
          </h3>
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', margin: 0 }}>
              No {tab} ads yet. Compose one on the left and click Render.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {filtered.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => setEditingId(a.id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                      padding: 'var(--space-2)', borderRadius: 'var(--radius-field)',
                      background: editingId === a.id ? 'var(--accent-50)' : 'transparent',
                      border: '1px solid var(--border-base)', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {a.assetUrl ? (
                      a.assetMime?.startsWith('video/') ? (
                        <video src={a.assetUrl} muted playsInline preload="metadata"
                          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }} />
                      ) : (
                        <img src={a.assetUrl} alt={a.headline}
                          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }} />
                      )
                    ) : (
                      <div style={{
                        width: 48, height: 48, borderRadius: 4,
                        background: 'var(--bg-subtle)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', color: 'var(--text-tertiary)',
                      }}>—</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.75rem', fontWeight: 600,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {a.headline || '(no headline)'}
                      </div>
                      <div style={{ fontSize: '0.625rem', color: 'var(--text-secondary)' }}>
                        {a.placement} · {a.aspectRatio}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
