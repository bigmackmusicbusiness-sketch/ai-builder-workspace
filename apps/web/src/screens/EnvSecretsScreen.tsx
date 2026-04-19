// apps/web/src/screens/EnvSecretsScreen.tsx — secret metadata browser.
// Shows name, scope, env, last-rotated, owner. NEVER shows values.
// Create/rotate/delete are approval-gated (server enforces; UI shows the gate).
import { useState } from 'react';

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

function envLabel(env: SecretMeta['env']): { label: string; color: string } {
  switch (env) {
    case 'production': return { label: 'Production', color: 'var(--error-500)' };
    case 'staging':    return { label: 'Staging',    color: 'var(--warning-500)' };
    case 'preview':    return { label: 'Preview',    color: 'var(--accent-500)' };
    default:           return { label: 'Dev',         color: 'var(--text-secondary)' };
  }
}

// ── Stub data (replaced by real API query in Step 9 wiring) ───────────────────

const STUB_SECRETS: SecretMeta[] = [
  { id: '1', name: 'STRIPE_SECRET_KEY',  scope: 'project', env: 'dev',        lastRotatedAt: null,                    ownerId: null, projectId: null },
  { id: '2', name: 'RESEND_API_KEY',     scope: 'project', env: 'staging',    lastRotatedAt: '2026-03-01T12:00:00Z',  ownerId: null, projectId: null },
  { id: '3', name: 'OPENAI_API_KEY',     scope: 'tenant',  env: 'production', lastRotatedAt: '2026-01-15T08:00:00Z',  ownerId: null, projectId: null },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function EnvSecretsScreen() {
  const [activeEnv, setActiveEnv] = useState<SecretMeta['env']>('dev');
  const [showCreate, setShowCreate] = useState(false);

  const visible = STUB_SECRETS.filter((s) => s.env === activeEnv);

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
          aria-label="Add secret"
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
        <div className="abw-banner abw-banner--warning" role="alert" aria-live="polite">
          <strong>Approval required.</strong> Creating, rotating, or deleting production secrets requires an approved action. Changes are fully audited.
        </div>
      )}

      {/* Secrets table */}
      {visible.length === 0 ? (
        <EmptyState env={activeEnv} onAdd={() => setShowCreate(true)} />
      ) : (
        <div className="abw-table-wrap">
          <table className="abw-table" aria-label="Secrets">
            <thead>
              <tr>
                <th>Name</th>
                <th>Scope</th>
                <th>Last rotated</th>
                <th>Owner</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((secret) => (
                <SecretRow key={secret.id} secret={secret} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog (simplified; real form wired with API in Step 9) */}
      {showCreate && (
        <CreateSecretDialog env={activeEnv} onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SecretRow({ secret }: { secret: SecretMeta }) {
  const { label, color } = envLabel(secret.env);
  return (
    <tr>
      <td>
        <span className="abw-table__name">{secret.name}</span>
      </td>
      <td>
        <span className="abw-badge">{secret.scope}</span>
      </td>
      <td style={{ color: 'var(--text-secondary)' }}>
        {relativeTime(secret.lastRotatedAt)}
      </td>
      <td style={{ color: 'var(--text-secondary)' }}>
        {secret.ownerId ? secret.ownerId.slice(0, 8) + '…' : '—'}
      </td>
      <td>
        <div className="abw-table__actions">
          <button
            className="abw-btn abw-btn--ghost abw-btn--sm"
            aria-label={`Rotate ${secret.name}`}
            title="Rotate"
          >
            ↻ Rotate
          </button>
          <button
            className="abw-btn abw-btn--ghost abw-btn--sm abw-btn--destructive"
            aria-label={`Delete ${secret.name}`}
            title="Delete"
          >
            Delete
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

function CreateSecretDialog({ env, onClose }: { env: string; onClose: () => void }) {
  const isProduction = env === 'production';

  return (
    <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label="Add secret">
      <div className="abw-dialog">
        <div className="abw-dialog__header">
          <h2 className="abw-dialog__title">Add Secret — {env}</h2>
          <button className="abw-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {isProduction && (
          <div className="abw-banner abw-banner--warning" style={{ marginBottom: 'var(--space-4)' }}>
            Production secrets require an approved action. This request will be submitted for review.
          </div>
        )}

        <div className="abw-dialog__body">
          <label className="abw-field-label" htmlFor="secret-name">Name</label>
          <input
            id="secret-name"
            className="abw-input"
            type="text"
            placeholder="MY_API_KEY"
            autoComplete="off"
            spellCheck={false}
          />
          <label className="abw-field-label" htmlFor="secret-value" style={{ marginTop: 'var(--space-3)' }}>Value</label>
          <input
            id="secret-value"
            className="abw-input"
            type="password"
            placeholder="Stored encrypted in vault"
            autoComplete="new-password"
          />
          <label className="abw-field-label" htmlFor="secret-scope" style={{ marginTop: 'var(--space-3)' }}>Scope</label>
          <select id="secret-scope" className="abw-select">
            <option value="project">Project</option>
            <option value="tenant">Tenant</option>
          </select>
        </div>

        <div className="abw-dialog__footer">
          <button className="abw-btn abw-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="abw-btn abw-btn--primary">
            {isProduction ? 'Request approval' : 'Add secret'}
          </button>
        </div>
      </div>
    </div>
  );
}
