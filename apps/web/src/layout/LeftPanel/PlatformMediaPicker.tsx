// apps/web/src/layout/LeftPanel/PlatformMediaPicker.tsx — cross-project media picker.
//
// 2026-05 update: the chat composer's paperclip used to open a native file picker.
// Now it opens a popover with two tabs:
//   • Local — drag/drop or click to upload from disk (delegated to ChatThread).
//   • Library — every shareable asset in the tenant, grouped by project.
//
// "Shareable" = image/*, video/*, audio/*, application/pdf. Markdown / plaintext /
// HTML files are intentionally excluded; they're prose, not media.
//
// Click an asset → the parent's onPick callback receives the asset metadata,
// which it forwards to the existing addAttachment flow on ChatThread. The
// chat backend already accepts attachments by `assetId` so no upload happens
// when picking from here — just a reference.
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';

export interface LibraryAsset {
  id:          string;
  name:        string;
  mimeType:    string;
  size:        number;
  url:         string;
  uploadedAt:  string;
  projectId:   string | null;
  projectName: string | null;
  projectSlug: string | null;
}

interface Props {
  /** Called when the user clicks on an asset thumbnail. */
  onPick: (asset: LibraryAsset) => void;
}

const KIND_FILTERS: { id: 'all' | 'image' | 'video' | 'audio' | 'pdf'; label: string; icon: string }[] = [
  { id: 'all',   label: 'All',    icon: '✦' },
  { id: 'image', label: 'Images', icon: '🖼' },
  { id: 'video', label: 'Videos', icon: '🎬' },
  { id: 'audio', label: 'Audio',  icon: '🎵' },
  { id: 'pdf',   label: 'PDFs',   icon: '📄' },
];

/** Returns "image" / "video" / "audio" / "pdf" / "other" based on MIME. */
function classify(mime: string): 'image' | 'video' | 'audio' | 'pdf' | 'other' {
  if (mime.startsWith('image/'))      return 'image';
  if (mime.startsWith('video/'))      return 'video';
  if (mime.startsWith('audio/'))      return 'audio';
  if (mime === 'application/pdf')     return 'pdf';
  return 'other';
}

function formatSize(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PlatformMediaPicker({ onPick }: Props) {
  const [kind, setKind]       = useState<'all' | 'image' | 'video' | 'audio' | 'pdf'>('all');
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [items, setItems]     = useState<LibraryAsset[]>([]);

  // Fetch the tenant-wide asset list. We always pass the full kinds whitelist
  // and filter client-side from the kind tab — the API roundtrip is the slow
  // part and the asset count per tenant is small enough that filtering in
  // memory is faster than re-fetching on every tab click.
  useEffect(() => {
    setLoading(true);
    apiFetch<{ assets: LibraryAsset[] }>('/api/assets?scope=tenant&kinds=image,video,audio,pdf')
      .then((res) => { setItems(res.assets); setLoading(false); })
      .catch((err) => { setError(err instanceof Error ? err.message : 'Failed to load'); setLoading(false); });
  }, []);

  // Filter + group by project name. "(Tenant library)" bucket holds the
  // null-projectId assets (e.g. AI gens that haven't been linked to a project).
  const grouped = useMemo(() => {
    const filtered = items.filter((a) => {
      if (kind !== 'all' && classify(a.mimeType) !== kind) return false;
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    const groups = new Map<string, LibraryAsset[]>();
    for (const a of filtered) {
      const key = a.projectName ?? '(Tenant library)';
      const list = groups.get(key);
      if (list) list.push(a); else groups.set(key, [a]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items, kind, search]);

  return (
    <div
      style={{
        maxHeight:    420,
        display:      'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header: filter chips + search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} role="group" aria-label="Filter by kind">
          {KIND_FILTERS.map((k) => {
            const active = kind === k.id;
            return (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                aria-pressed={active}
                style={{
                  height: 24, padding: '0 var(--space-2)',
                  border: `1px solid ${active ? 'var(--accent-500)' : 'var(--border-base)'}`,
                  borderRadius: 'var(--radius-field)',
                  background: active ? 'var(--accent-50)' : 'var(--bg-subtle)',
                  cursor: 'pointer', fontSize: '0.6875rem',
                  color: active ? 'var(--accent-600)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <span aria-hidden>{k.icon}</span>
                {k.label}
              </button>
            );
          })}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          aria-label="Search media library"
          style={{
            flex: 1,
            height: 24, padding: '0 var(--space-2)',
            border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)',
            background: 'var(--bg-subtle)',
            fontSize: '0.6875rem',
            color: 'var(--text-primary)',
          }}
        />
      </div>

      {/* Body: scrollable groups */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loading && (
          <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
            Loading library…
          </div>
        )}
        {error && (
          <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-error)', fontSize: '0.75rem' }}>
            {error}
          </div>
        )}
        {!loading && !error && grouped.length === 0 && (
          <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
            No media found. Generate or upload to populate your library.
          </div>
        )}
        {grouped.map(([projectLabel, list]) => (
          <div key={projectLabel} style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{
              fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em',
              color: 'var(--text-tertiary)', fontWeight: 600,
              padding: '0 var(--space-1) 4px',
            }}>
              {projectLabel} · {list.length}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
              gap: 6,
            }}>
              {list.map((a) => {
                const k = classify(a.mimeType);
                return (
                  <button
                    key={a.id}
                    onClick={() => onPick(a)}
                    title={`${a.name} · ${formatSize(a.size)}`}
                    style={{
                      position: 'relative',
                      width: '100%', aspectRatio: '1', minHeight: 72,
                      border: '1px solid var(--border-base)',
                      borderRadius: 'var(--radius-field)',
                      background: 'var(--bg-subtle)',
                      cursor: 'pointer', padding: 0, overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {k === 'image' ? (
                      <img
                        src={a.url}
                        alt={a.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        loading="lazy"
                      />
                    ) : k === 'video' ? (
                      <video
                        src={a.url}
                        muted
                        playsInline
                        preload="metadata"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ fontSize: '1.5rem' }} aria-hidden>
                        {k === 'audio' ? '🎵' : k === 'pdf' ? '📄' : '📦'}
                      </span>
                    )}
                    {/* Kind badge */}
                    <span style={{
                      position: 'absolute', top: 2, right: 2,
                      fontSize: '0.5625rem', padding: '1px 4px',
                      background: 'rgba(0,0,0,0.55)', color: '#fff',
                      borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>
                      {k}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 'var(--space-2)',
        padding: '4px 0 0',
        borderTop: '1px solid var(--border-base)',
        fontSize: '0.625rem', color: 'var(--text-tertiary)', textAlign: 'center',
      }}>
        Click an asset to attach. Tip — videos & images you generate land here automatically.
      </div>
    </div>
  );
}
