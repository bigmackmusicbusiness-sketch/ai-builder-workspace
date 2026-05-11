// apps/web/src/screens/PublishScreen.tsx — publish targets + deploy history.
// Manages Cloudflare Pages targets and deployment records via /api/publish/* endpoints.
// Production deploys surface the approval-required banner instead of deploying directly.
//
// May 2026: Publish is reached from the in-builder ▲ Publish button, NOT
// from a top-level nav tab — the route is per-project so it only makes
// sense once a project is selected. The "No project selected" empty
// state below is a defensive fallback for deep-links + stale tabs.
//
// Round 8 Feature B: adds an "Assign to new customer" button in the header
// that launches the AssignCustomerModal — provisions a SPS customer
// workspace + Stripe Checkout Session, blocks publishes until paid.
import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { apiFetch, ApiError } from '../lib/api';
import { useProjectStore } from '../lib/store/projectStore';
import { AssignCustomerModal } from './AssignCustomerModal';

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
  /** Set when the target has a Cloudflare-managed custom domain attached.
   *  After the first deploy with a domain, subsequent deploys default to
   *  this host without the picker re-asking. */
  customDomain?: string;
}

interface CfZone {
  id:     string;
  name:   string;
  status: string;
  paused: boolean;
  type:   string;
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
  error?:      string;
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
  const projectRecord = useProjectStore((s) => s.projects[s.currentProjectId]);
  const projectId     = useProjectStore((s) => s.currentProjectId !== 'global' ? s.currentProjectId : null);
  const projectSlug   = projectRecord?.slug ?? null;

  const [activeTab, setActiveTab]     = useState<Tab>('targets');
  const [targets, setTargets]         = useState<PublishTarget[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [showAdd, setShowAdd]         = useState(false);
  const [deploying, setDeploying]     = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<{ targetId: string; url: string } | null>(null);
  const [approvalRequired, setApprovalRequired] = useState<string | null>(null);
  /** Open the Cloudflare-domain picker for one target. When set, the
   *  DomainPickerDialog renders and runs the deploy on confirm. */
  const [pickerTarget, setPickerTarget] = useState<PublishTarget | null>(null);
  /** Round 8 Feature B: when true, the AssignCustomerModal renders over
   *  the screen. Closes via onClose or after the rep clicks "Done" on the
   *  post-submit Stripe-URL view. */
  const [showAssign, setShowAssign]     = useState(false);

  // ── Load targets + deployments on mount / project change ─────────────────
  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [tRes, dRes] = await Promise.all([
        apiFetch<{ targets: PublishTarget[] }>(`/api/publish/targets?projectId=${projectId}`),
        apiFetch<{ deployments: Deployment[] }>(`/api/publish/deployments?projectId=${projectId}`),
      ]);
      setTargets(tRes.targets);
      setDeployments(dRes.deployments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load publish data.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── Deploy ────────────────────────────────────────────────────────────────
  /** Top-level Deploy click handler. For static-export targets this opens
   *  the Cloudflare-domain picker (which then calls runDeploy with the
   *  chosen host). For other adapters it skips straight to runDeploy. */
  function handleDeploy(target: PublishTarget) {
    if (!projectId || !projectSlug) {
      alert('No active project selected.');
      return;
    }
    if (target.env === 'production') {
      setApprovalRequired(target.id);
      return;
    }
    // Static-export targets open the picker so the user can choose which
    // CF zone to attach. Cloudflare-pages targets skip the picker (they
    // deploy to the CF Pages-issued .pages.dev URL).
    if (target.provider === 'static-export') {
      setPickerTarget(target);
      return;
    }
    void runDeploy(target, null, null);
  }

  /** The actual deploy POST. Called by handleDeploy directly OR by the
   *  DomainPicker's onConfirm with a chosen { customDomain, cfZoneId }
   *  pair (or null + null for "skip — use platform URL"). */
  async function runDeploy(
    target: PublishTarget,
    customDomain: string | null,
    cfZoneId: string | null,
  ) {
    if (!projectId || !projectSlug) return;

    setPickerTarget(null);
    setDeploying(target.id);
    setDeployResult(null);
    setApprovalRequired(null);

    try {
      const body: Record<string, unknown> = {
        targetId:    target.id,
        projectId,
        projectSlug,
        framework:   'static',
      };
      if (customDomain && cfZoneId) {
        body.customDomain = customDomain;
        body.cfZoneId     = cfZoneId;
      }

      const res = await apiFetch<{
        status: string;
        url?: string;
        durationMs?: number;
        requiresApproval?: boolean;
        reason?: string;
      }>('/api/publish/deploy', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (res.requiresApproval) {
        setApprovalRequired(target.id);
      } else if (res.url) {
        setDeployResult({ targetId: target.id, url: res.url });
        // Refresh both lists so the new row appears + the target shows the
        // newly-bound customDomain on its card
        void loadData();
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Deploy failed. Check server logs.';
      setError(msg);
    } finally {
      setDeploying(null);
    }
  }

  // ── Add target ────────────────────────────────────────────────────────────
  async function handleAddTarget(draft: Omit<PublishTarget, 'id' | 'connected'>) {
    if (!projectId) return;
    try {
      const res = await apiFetch<{ target: PublishTarget }>('/api/publish/targets', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          name:     draft.name,
          provider: draft.provider,
          env:      draft.env,
          url:      draft.url,
        }),
      });
      setTargets((prev) => [...prev, res.target]);
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add target.');
    }
  }

  // ── Delete target ─────────────────────────────────────────────────────────
  async function handleDeleteTarget(id: string) {
    try {
      await apiFetch(`/api/publish/targets/${id}`, { method: 'DELETE' });
      setTargets((prev) => prev.filter((t) => t.id !== id));
      if (deployResult?.targetId === id) setDeployResult(null);
      if (approvalRequired === id) setApprovalRequired(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete target.');
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'targets',     label: 'Targets'     },
    { id: 'deployments', label: `Deployments${deployments.length ? ` (${deployments.length})` : ''}` },
  ];

  // ── No project selected ───────────────────────────────────────────────────
  // Defensive fallback only. The ▲ Publish button in the builder topbar is
  // gated on having an active project, so reps shouldn't hit this state in
  // normal use — only deep-links or sessions that lost their project hit.
  if (!projectId) {
    return (
      <div className="abw-screen">
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>🚀</span>
          <p className="abw-empty-state__label">No project selected</p>
          <p className="abw-empty-state__sub">
            Publish is a per-project surface — open a project first.
          </p>
          <Link to="/projects" className="abw-btn abw-btn--primary">
            Go to Projects
          </Link>
        </div>
      </div>
    );
  }

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
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <button className="abw-btn abw-btn--secondary" onClick={() => setShowAssign(true)} title="Assign this project to a new customer + send them a Stripe Checkout invoice. The site goes live when they pay.">
            Assign to new customer
          </button>
          {activeTab === 'targets' && (
            <button className="abw-btn abw-btn--primary" onClick={() => setShowAdd(true)}>
              + Add target
            </button>
          )}
        </div>
      </div>

      {/* Round 8 Feature B modal */}
      {showAssign && projectRecord && (
        <AssignCustomerModal
          projectId={projectId}
          projectName={projectRecord.name}
          onClose={() => setShowAssign(false)}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="abw-banner abw-banner--error" style={{ marginBottom: 'var(--space-4)' }}>
          <strong>Error:</strong> {error}
          <button
            className="abw-btn abw-btn--ghost abw-btn--xs"
            style={{ marginLeft: 'auto' }}
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Deploy success banner */}
      {deployResult && (
        <div className="abw-banner abw-banner--success" style={{ marginBottom: 'var(--space-4)' }}>
          <strong>Deployed!</strong> Live at{' '}
          <a href={deployResult.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
            {deployResult.url}
          </a>
          <button
            className="abw-btn abw-btn--ghost abw-btn--xs"
            style={{ marginLeft: 'auto' }}
            onClick={() => setDeployResult(null)}
          >
            ✕
          </button>
        </div>
      )}

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

      {/* Loading */}
      {loading && (
        <div className="abw-empty-state">
          <p className="abw-empty-state__label" style={{ color: 'var(--text-secondary)' }}>Loading…</p>
        </div>
      )}

      {/* ── Targets tab ── */}
      {!loading && activeTab === 'targets' && (
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
                    <button
                      className="abw-btn abw-btn--ghost abw-btn--sm"
                      aria-label={`Delete ${t.name}`}
                      onClick={() => void handleDeleteTarget(t.id)}
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {/* Live URL */}
                {(deployResult?.targetId === t.id ? deployResult.url : t.url) && (
                  <p style={{ marginTop: 'var(--space-3)', fontSize: '0.8125rem' }}>
                    <a
                      href={deployResult?.targetId === t.id ? deployResult.url : t.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent-500)' }}
                    >
                      {deployResult?.targetId === t.id ? deployResult.url : t.url}
                    </a>
                  </p>
                )}

                {/* Custom-domain badge */}
                {t.customDomain && (
                  <p style={{ marginTop: 'var(--space-2)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    🌐 Bound to <strong style={{ color: 'var(--text-primary)' }}>{t.customDomain}</strong>
                  </p>
                )}

                {/* Approval gate banner */}
                {(t.env === 'production' || approvalRequired === t.id) && (
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
      {!loading && activeTab === 'deployments' && (
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
                        {d.status === 'failed' && d.error && (
                          <span
                            title={d.error}
                            style={{ marginLeft: 4, cursor: 'help', fontSize: '0.7rem', color: 'var(--error-500)' }}
                          >
                            ⚠
                          </span>
                        )}
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

      {/* Cloudflare-domain picker (only fires for static-export deploys) */}
      {pickerTarget && (
        <DomainPickerDialog
          target={pickerTarget}
          onClose={() => setPickerTarget(null)}
          onConfirm={(customDomain, cfZoneId) => void runDeploy(pickerTarget, customDomain, cfZoneId)}
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
  onAdd:   (t: Omit<PublishTarget, 'id' | 'connected'>) => void;
}) {
  const [provider, setProvider] = useState<PublishProvider>('cloudflare-pages');
  const [name, setName]         = useState('');
  const [env, setEnv]           = useState<TargetEnv>('preview');
  const [url, setUrl]           = useState('');
  const [saving, setSaving]     = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await onAdd({
      name:     name.trim(),
      provider,
      env,
      url:      url.trim() || undefined,
    });
    setSaving(false);
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
              <label className="abw-field-label" htmlFor="target-url">
                Pages URL <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional)</span>
              </label>
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
          <button
            className="abw-btn abw-btn--primary"
            disabled={!name.trim() || saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Adding…' : 'Add target'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DomainPickerDialog ────────────────────────────────────────────────────────

/** Modal that lists the user's Cloudflare zones, lets them pick one + an
 *  optional subdomain, and confirms the chosen FQDN. The Deploy actually
 *  runs in the parent on confirm.
 *
 *  Includes a "Buy a domain on Cloudflare ↗" deep-link for users who don't
 *  have one yet, and a "Skip — use platform URL" escape hatch. */
function DomainPickerDialog({
  target,
  onClose,
  onConfirm,
}: {
  target:    PublishTarget;
  onClose:   () => void;
  onConfirm: (customDomain: string | null, cfZoneId: string | null) => void;
}) {
  const [zones, setZones]           = useState<CfZone[]>([]);
  const [zoneId, setZoneId]         = useState<string>('');
  const [subdomain, setSubdomain]   = useState<string>('');
  const [accountId, setAccountId]   = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [helpHint, setHelpHint]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [zonesRes, acctRes] = await Promise.all([
          apiFetch<{ zones: CfZone[]; helpHint?: string }>('/api/cf/zones'),
          apiFetch<{ accountId: string }>('/api/cf/account').catch(() => ({ accountId: '' })),
        ]);
        if (cancelled) return;
        setZones(zonesRes.zones);
        setHelpHint(zonesRes.helpHint ?? null);
        setAccountId(acctRes.accountId || null);
        // Pre-select the target's existing customDomain's zone if there is one
        if (target.customDomain) {
          const matchedZone = zonesRes.zones.find((z) => target.customDomain!.endsWith(z.name));
          if (matchedZone) {
            setZoneId(matchedZone.id);
            const sub = target.customDomain.slice(0, target.customDomain.length - matchedZone.name.length).replace(/\.$/, '');
            setSubdomain(sub);
          }
        } else if (zonesRes.zones[0]) {
          setZoneId(zonesRes.zones[0].id);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not load Cloudflare zones.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target.customDomain]);

  const selectedZone = zones.find((z) => z.id === zoneId);
  const sub          = subdomain.trim().replace(/^\.+|\.+$/g, '').toLowerCase();
  const fullHost     = selectedZone ? (sub ? `${sub}.${selectedZone.name}` : selectedZone.name) : '';

  const buyHref = accountId
    ? `https://dash.cloudflare.com/${accountId}/domains/register`
    : 'https://dash.cloudflare.com/?to=/:account/domains/register';

  return (
    <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label="Pick a Cloudflare domain">
      <div className="abw-dialog">
        <div className="abw-dialog__header">
          <h2 className="abw-dialog__title">Deploy {target.name}</h2>
          <button className="abw-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="abw-dialog__body" style={{ gap: 'var(--space-4)' }}>
          {loading ? (
            <p style={{ color: 'var(--text-secondary)' }}>Loading your Cloudflare zones…</p>
          ) : error ? (
            <div className="abw-banner abw-banner--error">
              <strong>Could not load zones.</strong> {error}
            </div>
          ) : zones.length === 0 ? (
            <div className="abw-callout">
              <span className="abw-callout__icon" aria-hidden>🌐</span>
              <span>
                No Cloudflare zones found on your account. {helpHint
                  ? <span style={{ color: 'var(--text-secondary)' }}>{helpHint}</span>
                  : 'Buy or transfer a domain to Cloudflare to attach it here.'}
              </span>
            </div>
          ) : (
            <>
              <div>
                <label className="abw-field-label" htmlFor="picker-zone">Domain</label>
                <select
                  id="picker-zone"
                  className="abw-select"
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name} {z.status !== 'active' ? `(${z.status})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="abw-field-label" htmlFor="picker-sub">
                  Subdomain <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional — leave blank for apex)</span>
                </label>
                <input
                  id="picker-sub"
                  className="abw-input"
                  type="text"
                  placeholder="www"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value)}
                />
              </div>

              {fullHost && (
                <div className="abw-callout">
                  <span className="abw-callout__icon" aria-hidden>✨</span>
                  <span>
                    Site will live at <strong>https://{fullHost}/</strong> (CF Proxy + TLS, ~30s DNS propagation).
                  </span>
                </div>
              )}
            </>
          )}

          <a
            href={buyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="abw-btn abw-btn--ghost abw-btn--sm"
            style={{ alignSelf: 'flex-start' }}
          >
            🛒 Buy a new domain on Cloudflare ↗
          </a>
        </div>
        <div className="abw-dialog__footer">
          <button
            className="abw-btn abw-btn--ghost"
            onClick={() => onConfirm(null, null)}
          >
            Skip — use platform URL
          </button>
          <button
            className="abw-btn abw-btn--primary"
            disabled={!fullHost || !zoneId || loading}
            onClick={() => onConfirm(fullHost, zoneId)}
          >
            {fullHost ? `Deploy to ${fullHost}` : 'Deploy'}
          </button>
        </div>
      </div>
    </div>
  );
}
