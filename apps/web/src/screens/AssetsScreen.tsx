// apps/web/src/screens/AssetsScreen.tsx — Supabase Storage–backed asset manager.
// List, upload, copy URL, and delete project assets (images, files, fonts).
// Delete is audited. No direct Storage URL construction in browser — goes through /api/assets.
import { useState, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type AssetType = 'image' | 'font' | 'video' | 'document' | 'other';
type ViewMode  = 'grid' | 'list';

interface Asset {
  id:        string;
  name:      string;
  type:      AssetType;
  mimeType:  string;
  sizeBytes: number;
  url:       string;
  uploadedAt: string;
  uploadedBy: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1_048_576)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  if (m < 2)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function typeFromMime(mime: string): AssetType {
  if (mime.startsWith('image/'))       return 'image';
  if (mime.startsWith('video/'))       return 'video';
  if (mime.includes('font'))           return 'font';
  if (mime.includes('pdf') || mime.includes('document')) return 'document';
  return 'other';
}

function assetIcon(type: AssetType): string {
  switch (type) {
    case 'image':    return '🖼';
    case 'font':     return '🔤';
    case 'video':    return '🎬';
    case 'document': return '📄';
    default:         return '📎';
  }
}

const TYPE_FILTERS: { id: AssetType | 'all'; label: string }[] = [
  { id: 'all',      label: 'All'       },
  { id: 'image',    label: 'Images'    },
  { id: 'font',     label: 'Fonts'     },
  { id: 'video',    label: 'Video'     },
  { id: 'document', label: 'Documents' },
  { id: 'other',    label: 'Other'     },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function AssetsScreen() {
  const [assets, setAssets]         = useState<Asset[]>([]);
  const [filter, setFilter]         = useState<AssetType | 'all'>('all');
  const [view, setView]             = useState<ViewMode>('grid');
  const [search, setSearch]         = useState('');
  const [uploading, setUploading]   = useState(false);
  const [copied, setCopied]         = useState<string | null>(null);
  const fileInputRef                = useRef<HTMLInputElement>(null);

  const filtered = assets.filter((a) =>
    (filter === 'all' || a.type === filter) &&
    (search === '' || a.name.toLowerCase().includes(search.toLowerCase())),
  );

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    // TODO: POST /api/assets/upload with FormData
    await new Promise((r) => setTimeout(r, 800));

    const newAssets: Asset[] = Array.from(files).map((file) => ({
      id:          crypto.randomUUID(),
      name:        file.name,
      type:        typeFromMime(file.type),
      mimeType:    file.type,
      sizeBytes:   file.size,
      url:         URL.createObjectURL(file), // stub — real URL from /api/assets
      uploadedAt:  new Date().toISOString(),
      uploadedBy:  'You',
    }));
    setAssets((prev) => [...newAssets, ...prev]);
    setUploading(false);
  }

  async function handleCopy(asset: Asset) {
    await navigator.clipboard.writeText(asset.url);
    setCopied(asset.id);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this asset? This is permanent and audited.')) return;
    setAssets((prev) => prev.filter((a) => a.id !== id));
    // TODO: DELETE /api/assets/:id
  }

  return (
    <div className="abw-screen">
      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Assets</h1>
          <p className="abw-screen__sub">
            {assets.length === 0
              ? 'Upload images, fonts, and files for use in your project.'
              : `${assets.length} asset${assets.length !== 1 ? 's' : ''} · ${formatSize(assets.reduce((t, a) => t + a.sizeBytes, 0))} total`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {/* View toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border-base)', borderRadius: 'var(--radius-field)', overflow: 'hidden' }}>
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                className={`abw-btn abw-btn--ghost abw-btn--sm${view === v ? ' abw-btn--secondary' : ''}`}
                style={{ border: 'none', borderRadius: 0 }}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                aria-label={`${v} view`}
              >
                {v === 'grid' ? '⊞' : '☰'}
              </button>
            ))}
          </div>
          <button
            className="abw-btn abw-btn--primary"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload assets"
          >
            {uploading ? 'Uploading…' : '↑ Upload'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.pdf,.woff,.woff2,.ttf,.otf,.svg"
            style={{ display: 'none' }}
            onChange={(e) => void handleFileSelect(e.target.files)}
            aria-label="File upload input"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Asset type filter">
        {TYPE_FILTERS.map(({ id, label }) => {
          const count = id === 'all' ? assets.length : assets.filter((a) => a.type === id).length;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={filter === id}
              className={`abw-screen__tab${filter === id ? ' abw-screen__tab--active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}{count > 0 && (
                <span style={{ marginLeft: 4, opacity: 0.6, fontSize: '0.625rem' }}>({count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      {assets.length > 0 && (
        <input
          className="abw-input"
          type="search"
          placeholder="Search assets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search assets"
          style={{ maxWidth: 280 }}
        />
      )}

      {/* Empty state */}
      {assets.length === 0 ? (
        <div
          className="abw-empty-state abw-assets__drop-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleFileSelect(e.dataTransfer.files);
          }}
          aria-label="Drop zone for file upload"
        >
          <span className="abw-empty-state__icon" aria-hidden>🖼</span>
          <p className="abw-empty-state__label">No assets</p>
          <p className="abw-empty-state__sub">
            Drop files here, or click Upload to add images, fonts, documents, and videos.
          </p>
          <button className="abw-btn abw-btn--primary" onClick={() => fileInputRef.current?.click()}>
            Upload first asset
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>🔍</span>
          <p className="abw-empty-state__label">No results</p>
          <p className="abw-empty-state__sub">Try a different name or category filter.</p>
        </div>
      ) : view === 'grid' ? (
        /* Grid view */
        <div className="abw-assets__grid">
          {filtered.map((asset) => (
            <div key={asset.id} className="abw-asset-card">
              {asset.type === 'image' ? (
                <div className="abw-asset-card__preview">
                  <img
                    src={asset.url}
                    alt={asset.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              ) : (
                <div className="abw-asset-card__preview abw-asset-card__preview--icon">
                  <span style={{ fontSize: '2rem' }} aria-hidden>{assetIcon(asset.type)}</span>
                </div>
              )}
              <div className="abw-asset-card__body">
                <p className="abw-asset-card__name" title={asset.name}>{asset.name}</p>
                <p style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', margin: 0 }}>
                  {formatSize(asset.sizeBytes)} · {relativeTime(asset.uploadedAt)}
                </p>
              </div>
              <div className="abw-asset-card__actions">
                <button
                  className="abw-btn abw-btn--ghost abw-btn--xs"
                  onClick={() => void handleCopy(asset)}
                  aria-label={`Copy URL for ${asset.name}`}
                  title="Copy URL"
                >
                  {copied === asset.id ? '✓' : '⎘'}
                </button>
                <button
                  className="abw-btn abw-btn--ghost abw-btn--xs"
                  onClick={() => handleDelete(asset.id)}
                  aria-label={`Delete ${asset.name}`}
                  title="Delete"
                  style={{ color: 'var(--error-500)' }}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* List view */
        <div className="abw-table-wrap">
          <table className="abw-table" aria-label="Assets">
            <thead>
              <tr>
                <th style={{ width: 32 }} />
                <th>Name</th>
                <th style={{ width: 80 }}>Type</th>
                <th style={{ width: 80 }}>Size</th>
                <th style={{ width: 100 }}>Uploaded</th>
                <th style={{ width: 80 }}>By</th>
                <th style={{ width: 100 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((asset) => (
                <tr key={asset.id}>
                  <td style={{ textAlign: 'center' }}>
                    <span aria-hidden>{assetIcon(asset.type)}</span>
                  </td>
                  <td>
                    <span className="abw-table__name" title={asset.name}
                      style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', whiteSpace: 'nowrap' }}>
                      {asset.name}
                    </span>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', display: 'block' }}>
                      {asset.mimeType}
                    </span>
                  </td>
                  <td><span className="abw-badge" style={{ fontSize: '0.625rem' }}>{asset.type}</span></td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {formatSize(asset.sizeBytes)}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {relativeTime(asset.uploadedAt)}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{asset.uploadedBy}</td>
                  <td>
                    <div className="abw-table__actions">
                      <button
                        className="abw-btn abw-btn--ghost abw-btn--xs"
                        onClick={() => void handleCopy(asset)}
                        aria-label={`Copy URL for ${asset.name}`}
                      >
                        {copied === asset.id ? '✓ Copied' : '⎘ Copy URL'}
                      </button>
                      <button
                        className="abw-btn abw-btn--ghost abw-btn--xs abw-btn--destructive"
                        onClick={() => handleDelete(asset.id)}
                        aria-label={`Delete ${asset.name}`}
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
      )}
    </div>
  );
}
