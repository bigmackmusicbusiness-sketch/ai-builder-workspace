// apps/web/src/screens/EnvSecretsScreen.tsx — secret metadata browser.
// Shows name, scope, env, last-rotated. NEVER shows values.
// Create/rotate/delete call the API with the user's Bearer token.
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SecretMeta {
  id:            string;
  name:          string;
  scope:         'project' | 'tenant' | 'global';
  env:           'dev' | 'staging' | 'preview' | 'production';
  lastRotatedAt: string | null;
  ownerId:       string | null;
  projectId:     string | null;
}

const ENV_ORDER: SecretMeta['env'][] = ['dev', 'staging', 'preview', 'production'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30)  return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function envLabel(env: SecretMeta['env']): { label: string } {
  switch (env) {
    case 'production': return { label: 'Production' };
    case 'staging':    return { label: 'Staging' };
    case 'preview':    return { label: 'Preview' };
    default:           return { label: 'Dev' };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EnvSecretsScreen() {
  const [activeEnv,  setActiveEnv]  = useState<SecretMeta['env']>('dev');
  const [showCreate, setShowCreate] = useState(false);
  const [secrets,    setSecrets]    = useState<SecretMeta[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadSecrets = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await apiFetch<{ secrets: SecretMeta[] }>('/api/secrets');
      setSecrets(data.secrets);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load secrets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSecrets(); }, [loadSecrets]);

  const visible = secrets.filter((s) => s.env === activeEnv);

  function handleCreated() {
    setShowCreate(false);
    void loadSecrets();
  }

  return (
    <div className="abw-screen">
      {/* Page header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Env &amp; Secrets</h1>
          <p className="abw-screen__sub">Secret metadata only — values are stored in the vault and never returned to the browser.</p>
        </div>
        <button
          className="abw-btn abw-btn--primary"
          onClick={() => setShowCreate(true)}
        >
          + Add secret
        </button>
      </div>

      {/* Env tabs */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Environments">
        {ENV_ORDER.map((env) => (
          <button
            key={env}
            role="tab"
            aria-selected={activeEnv === env}
            className={`abw-screen__tab${activeEnv === env ? ' abw-screen__tab--active' : ''}`}
            onClick={() => setActiveEnv(env)}
          >
            {envLabel(env).label}
          </button>
        ))}
      </div>

      {/* Production notice */}
      {activeEnv === 'production' && (
        <div className="abw-banner abw-banner--warning" role="alert">
          <strong>Approval required.</strong> Creating, rotating, or deleting production secrets requires an approved action.
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="abw-empty-state">
          <p className="abw-empty-state__label">Loading…</p>
        </div>
      ) : fetchError ? (
        <div className="abw-banner abw-banner--error" role="alert">{fetchError}</div>
      ) : visible.length === 0 ? (
        <EmptyState env={activeEnv} onAdd={() => setShowCreate(true)} />
      ) : (
        <div className="abw-table-wrap">
          <table className="abw-table" aria-label="Secrets">
            <thead>
              <tr>
                <th>Name</th>
                <th>Scope</th>
                <th>Last rotated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((secret) => (
                <SecretRow key={secret.id} secret={secret} onRefresh={loadSecrets} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateSecretDialog
          env={activeEnv}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SecretRow({ secret, onRefresh }: { secret: SecretMeta; onRefresh: () => void }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete secret "${secret.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/secrets/${secret.id}`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(false);
    }
  }

  return (
    <tr>
      <td><span className="abw-table__name">{secret.name}</span></td>
      <td><span className="abw-badge">{secret.scope}</span></td>
      <td style={{ color: 'var(--text-secondary)' }}>{relativeTime(secret.lastRotatedAt)}</td>
      <td>
        <div className="abw-table__actions">
          <button
            className="abw-btn abw-btn--ghost abw-btn--sm abw-btn--destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      </td>
    </tr>
  );
}

function EmptyState({ env, onAdd }: { env: string; onAdd: () => void }) {
  return (
    <div className="abw-empty-state">
      <span className="abw-empty-state__icon" aria-hidden>🔐</span>
      <p className="abw-empty-state__label">No secrets in {env}</p>
      <p className="abw-empty-state__sub">Secrets are stored encrypted in the vault. Values are never logged or returned to the browser.</p>
      <button className="abw-btn abw-btn--primary" onClick={onAdd}>Add first secret</button>
    </div>
  );
}

function CreateSecretDialog({
  env,
  onClose,
  onCreated,
}: {
  env: SecretMeta['env'];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name,    setName]    = useState('');
  const [value,   setValue]   = useState('');
  const [scope,   setScope]   = useState<'project' | 'tenant'>('project');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const isProduction = env === 'production';
  const canSubmit    = name.trim().length > 0 && value.length > 0 && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/secrets', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim().toUpperCase(), value, scope, env }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError
        ? (err.status === 403 ? 'Production secrets require an approved action.' : err.message)
        : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label="Add secret">
      <div className="abw-dialog">
        <div className="abw-dialog__header">
          <h2 className="abw-dialog__title">Add Secret — {env}</h2>
          <button className="abw-dialog__close" onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
        </div>

        {isProduction && (
          <div className="abw-banner abw-banner--warning" style={{ margin: '0 0 var(--space-4)' }}>
            Production secrets require an approved action. This request will be submitted for review.
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="abw-dialog__body">
            <label className="abw-field-label" htmlFor="secret-name">Name</label>
            <input
              id="secret-name"
              className="abw-input"
              type="text"
              placeholder="MY_API_KEY"
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              required
            />

            <label className="abw-field-label" htmlFor="secret-value" style={{ marginTop: 'var(--space-3)' }}>Value</label>
            <input
              id="secret-value"
              className="abw-input"
              type="password"
              placeholder="Stored encrypted in vault"
              autoComplete="new-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
              required
            />

            <label className="abw-field-label" htmlFor="secret-scope" style={{ marginTop: 'var(--space-3)' }}>Scope</label>
            <select
              id="secret-scope"
              className="abw-select"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'project' | 'tenant')}
              disabled={busy}
            >
              <option value="project">Project</option>
              <option value="tenant">Tenant</option>
            </select>

            {error && (
              <p className="abw-banner abw-banner--error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
                {error}
              </p>
            )}
          </div>

          <div className="abw-dialog__footer">
            <button type="button" className="abw-btn abw-btn--ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="abw-btn abw-btn--primary" disabled={!canSubmit}>
              {busy ? 'Saving…' : isProduction ? 'Request approval' : 'Add secret'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
