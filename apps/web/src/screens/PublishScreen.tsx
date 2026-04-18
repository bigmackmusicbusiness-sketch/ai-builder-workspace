// apps/web/src/screens/PublishScreen.tsx — publish targets + deploy history.
// Manage Cloudflare Pages targets and static exports. Production deploys require approval.
// No live API calls until /api/publish routes are wired; stubs surfaced clearly.
import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type PublishProvider = 'cloudflare-pages' | 'static-export' | 'supabase';
type DeployStatus    = 'success' | 'failed' | 'building' | 'cancelled';
type TargetEnv       = 'preview' | 'production';

interface PublishTarget {
  id:          string;
  name:        string;
  provider:    PublishProvider;
  env:         TargetEnv;
  url?:        string;
  connected:   boolean;
  lastDeploy?: string;
}

interface Deployment {
  id:          string;
  targetId:    string;
  targetName:  string;
  status:      DeployStatus;
  env:         TargetEnv;
  url?:        string;
  triggeredBy: string;
  startedAt:   string;
  durationMs?: number;
  commitMsg?:  string;
}

type Tab = 'targets' | 'deployments';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms   = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 2)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function providerLabel(p: PublishProvider): string {
  switch (p) {
    case 'cloudflare-pages': return 'Cloudflare Pages';
    case 'static-export':    return 'Static Export';
    case 'supabase':         return 'Supabase Storage';
  }
}

function providerIcon(p: PublishProvider): string {
  switch (p) {
    case 'cloudflare-pages': return '☁️';
    case 'static-export':    return '📦';
    case 'supabase':         return '🗄';
  }
}

function deployStatusStyle(s: DeployStatus): { color: string; label: string } {
  switch (s) {
    case 'success':   return { color: 'var(--success-500)', label: 'Success' };
    case 'failed':    return { color: 'var(--error-500)',   label: 'Failed'  };
    case 'building':  return { color: 'var(--warning-500)', label: 'Building…' };
    case 'cancelled': return { color: 'var(--text-secondary)', label: 'Cancelled' };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PublishScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('targets');
  const [targets, setTargets]     = useState<PublishTarget[]>([]);
  const [deployments]             = useState<Deployment[]>([]);
  const [showAdd, setShowAdd]     = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);

  async function handleDeploy(target: PublishTarget) {
    if (target.env === 'production') {
      // In real impl: POST /api/approvals/check → requiresApproval → open approval bundle
      alert('Production deploys require an approved action. (approval gate not yet wired)');
      return;
    }
    setDeploying(target.id);
    // TODO: POST /api/publish/deploy
    await new Promise((r) => setTimeout(r, 1500));
    setDeploying(null);
  }

  function handleAddTarget(t: PublishTarget) {
    setTargets((prev) => [...prev, t]);
    setShowAdd(false);
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'targets',     label: 'Targets'     },
    { id: 'deployments', label: 'Deployments' },
  ];

  return (
    <div className="abw-screen">
      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Publish</h1>
          <p className="abw-screen__sub">
            Deploy to Cloudflare Pages or export as a static bundle. Production deploys require approval.
          </p>
        </div>
        {activeTab === 'targets' && (
          <button className="abw-btn abw-btn--primary" onClick={() => setShowAdd(true)}>
            + Add target
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Publish sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            className={`abw-screen__tab${activeTab === id ? ' abw-screen__tab--active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Targets tab ── */}
      {activeTab === 'targets' && (
        targets.length === 0 ? (
          <div className="abw-empty-state">
            <span className="abw-empty-state__icon" aria-hidden>🚀</span>
            <p className="abw-empty-state__label">No publish targets</p>
            <p className="abw-empty-state__sub">
              Add a Cloudflare Pages project or configure a static export to start deploying.
            </p>
            <button className="abw-btn abw-btn--primary" onClick={() => setShowAdd(true)}>
              Add first target
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {targets.map((t) => (
              <div key={t.id} className="abw-card">
                <div className="abw-card__header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <span style={{ fontSize: '1.5rem' }} aria-hidden>{providerIcon(t.provider)}</span>
                    <div>
                      <h2 className="abw-card__title" style={{ marginBottom: 2 }}>{t.name}</h2>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {providerLabel(t.provider)} &middot;{' '}
                        <span style={{ color: t.env === 'production' ? 'var(--error-500)' : 'var(--accent-500)', fontWeight: 600 }}>
                          {t.env}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    {t.connected && (
                      <span style={{ fontSize: '0.6875rem', color: 'var(--success-500)', fontWeight: 600 }}>
                        ● Connected
                      </span>
                    )}
                    <button
                      className="abw-btn abw-btn--primary abw-btn--sm"
                      disabled={deploying === t.id}
                      onClick={() => void handleDeploy(t)}
                      aria-label={`Deploy to ${t.name}`}
                    >
                      {deploying === t.id ? 'Deploying…' : '▲ Deploy'}
                    </button>
                    <button className="abw-btn abw-btn--ghost abw-btn--sm" aria-label={`Settings for ${t.name}`}>
                      ⚙
                    </button>
                  </div>
                </div>

                {t.url && (
                  <p style={{ marginTop: 'var(--space-3)', fontSize: '0.8125rem' }}>
                    <a href={t.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-500)' }}>
                      {t.url}
                    </a>
                  </p>
                )}

                {t.env === 'production' && (
                  <div className="abw-banner abw-banner--warning" style={{ marginTop: 'var(--space-3)' }}>
                    <strong>Approval required.</strong> Deployments to production must be reviewed and approved before they go live.
                  </div>
                )}

                {t.lastDeploy && (
                  <p style={{ marginTop: 'var(--space-2)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Last deploy: {relativeTime(t.lastDeploy)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Deployments tab ── */}
      {activeTab === 'deployments' && (
        deployments.length === 0 ? (
          <div className="abw-empty-state">
            <span className="abw-empty-state__icon" aria-hidden>📋</span>
            <p className="abw-empty-state__label">No deployments yet</p>
            <p className="abw-empty-state__sub">
              Deploy to a target above and the history will appear here.
            </p>
          </div>
        ) : (
          <div className="abw-table-wrap">
            <table className="abw-table" aria-label="Deployment history">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Env</th>
                  <th>Commit</th>
                  <th>Triggered by</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => {
                  const { color, label } = deployStatusStyle(d.status);
                  return (
                    <tr key={d.id}>
                      <td>
                        <span style={{ color, fontWeight: 600, fontSize: '0.75rem' }}>{label}</span>
                      </td>
                      <td><span className="abw-table__name">{d.targetName}</span></td>
                      <td>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: d.env === 'production' ? 'var(--error-500)' : 'var(--accent-500)' }}>
                          {d.env}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.commitMsg ?? '—'}
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{d.triggeredBy}</td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {relativeTime(d.startedAt)}
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {d.durationMs != null ? `${(d.durationMs / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td>
                        {d.url && (
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noreferrer"
                            className="abw-btn abw-btn--ghost abw-btn--xs"
                          >
                            View ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Add target dialog */}
      {showAdd && (
        <AddTargetDialog
          onClose={() => setShowAdd(false)}
          onAdd={handleAddTarget}
        />
      )}
    </div>
  );
}

// ── AddTargetDialog ───────────────────────────────────────────────────────────

function AddTargetDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd:   (t: PublishTarget) => void;
}) {
  const [provider, setProvider] = useState<PublishProvider>('cloudflare-pages');
  const [name, setName]         = useState('');
  const [env, setEnv]           = useState<TargetEnv>('preview');
  const [url, setUrl]           = useState('');

  function handleSave() {
    if (!name.trim()) return;
    onAdd({
      id:        crypto.randomUUID(),
      name:      name.trim(),
      provider,
      env,
      url:       url.trim() || undefined,
      connected: false,
    });
  }

  const providers: { id: PublishProvider; label: string; icon: string }[] = [
    { id: 'cloudflare-pages', label: 'Cloudflare Pages', icon: '☁️' },
    { id: 'static-export',    label: 'Static Export',    icon: '📦' },
    { id: 'supabase',         label: 'Supabase Storage', icon: '🗄' },
  ];

  return (
    <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label="Add publish target">
      <div className="abw-dialog">
        <div className="abw-dialog__header">
          <h2 className="abw-dialog__title">Add publish target</h2>
          <button className="abw-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="abw-dialog__body" style={{ gap: 'var(--space-4)' }}>
          {/* Provider picker */}
          <div>
            <p className="abw-field-label">Provider</p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {providers.map((p) => (
                <button
                  key={p.id}
                  className={`abw-btn${provider === p.id ? ' abw-btn--secondary' : ' abw-btn--ghost'} abw-btn--sm`}
                  onClick={() => setProvider(p.id)}
                  aria-pressed={provider === p.id}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="abw-field-label" htmlFor="target-name">Name</label>
            <input
              id="target-name"
              className="abw-input"
              type="text"
              placeholder="My site — Cloudflare Pages"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="abw-field-label" htmlFor="target-env">Environment</label>
            <select
              id="target-env"
              className="abw-select"
              value={env}
              onChange={(e) => setEnv(e.target.value as TargetEnv)}
            >
              <option value="preview">Preview</option>
              <option value="production">Production</option>
            </select>
            {env === 'production' && (
              <p style={{ fontSize: '0.75rem', color: 'var(--error-500)', marginTop: 'var(--space-1)' }}>
                Deploys to this target will require approval.
              </p>
            )}
          </div>

          {provider === 'cloudflare-pages' && (
            <div>
              <label className="abw-field-label" htmlFor="target-url">Pages URL <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional)</span></label>
              <input
                id="target-url"
                className="abw-input"
                type="url"
                placeholder="https://my-project.pages.dev"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          )}

          <div className="abw-callout">
            <span className="abw-callout__icon" aria-hidden>🔐</span>
            <span>Cloudflare API tokens are stored in the vault — never in this form.</span>
          </div>
        </div>
        <div className="abw-dialog__footer">
          <button className="abw-btn abw-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="abw-btn abw-btn--primary" disabled={!name.trim()} onClick={handleSave}>
            Add target
          </button>
        </div>
      </div>
    </div>
  );
}
