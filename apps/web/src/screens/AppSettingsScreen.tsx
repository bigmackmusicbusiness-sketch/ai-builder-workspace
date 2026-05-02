// apps/web/src/screens/AppSettingsScreen.tsx — workspace-wide settings + provider config.
// Tabs: General · Models · Danger zone.
// API keys live in the vault — the Models tab never displays raw values.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

type Tab = 'general' | 'models' | 'danger';

export function AppSettingsScreen() {
  const [tab, setTab] = useState<Tab>('general');

  return (
    <div className="abw-screen">
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Settings</h1>
          <p className="abw-screen__sub">Workspace defaults, AI providers, account.</p>
        </div>
      </div>

      <div className="abw-screen__tabs" role="tablist" aria-label="Settings sections">
        <button
          role="tab"
          aria-selected={tab === 'general'}
          className={`abw-screen__tab${tab === 'general' ? ' abw-screen__tab--active' : ''}`}
          onClick={() => setTab('general')}
        >
          General
        </button>
        <button
          role="tab"
          aria-selected={tab === 'models'}
          className={`abw-screen__tab${tab === 'models' ? ' abw-screen__tab--active' : ''}`}
          onClick={() => setTab('models')}
        >
          Models
        </button>
        <button
          role="tab"
          aria-selected={tab === 'danger'}
          className={`abw-screen__tab${tab === 'danger' ? ' abw-screen__tab--active' : ''}`}
          onClick={() => setTab('danger')}
          style={{ marginLeft: 'auto' }}
        >
          Danger zone
        </button>
      </div>

      <div style={{ maxWidth: 720, paddingTop: 'var(--space-4)' }}>
        {tab === 'general' && <GeneralTab />}
        {tab === 'models'  && <ModelsTab  />}
        {tab === 'danger'  && <DangerTab  />}
      </div>
    </div>
  );
}

// ── General tab ──────────────────────────────────────────────────────────────

function GeneralTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <label className="abw-field-label" htmlFor="settings-theme">Theme</label>
        <select id="settings-theme" className="abw-select">
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </div>
      <div>
        <label className="abw-field-label" htmlFor="settings-default-env">Default environment</label>
        <select id="settings-default-env" className="abw-select">
          <option value="dev">Dev</option>
          <option value="staging">Staging</option>
          <option value="preview">Preview</option>
        </select>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', paddingTop: 'var(--space-3)' }}>
        <button className="abw-btn abw-btn--ghost">Cancel</button>
        <button className="abw-btn abw-btn--primary">Save settings</button>
      </div>
    </div>
  );
}

// ── Models tab — absorbed from former ProviderSettingsScreen ──────────────────

type ProviderHealth = 'checking' | 'ok' | 'error' | 'unconfigured';

interface ProviderConfig {
  id:           string;
  provider:     'minimax' | 'ollama';
  name:         string;
  baseUrl?:     string;
  defaultModel: string;
  health:       ProviderHealth;
  latencyMs?:   number;
  detail?:      string;
  models:       { id: string; label: string }[];
}

const STUB_PROVIDERS: ProviderConfig[] = [
  {
    id: '1', provider: 'minimax', name: 'MiniMax 2.7',
    defaultModel: 'abab6.5s-chat',
    health: 'unconfigured',
    detail: 'No API key configured. Add it in Env secrets.',
    models: [
      { id: 'abab6.5s-chat', label: 'MiniMax 2.7 (abab6.5s-chat)' },
      { id: 'abab5.5s-chat', label: 'MiniMax 2.5 (abab5.5s-chat)' },
    ],
  },
  {
    id: '2', provider: 'ollama', name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3',
    health: 'checking',
    models: [
      { id: 'llama3',    label: 'LLaMA 3 (8B)' },
      { id: 'mistral',   label: 'Mistral 7B'   },
      { id: 'codestral', label: 'Codestral'    },
    ],
  },
];

interface ApiProviderHealth {
  provider:   'minimax' | 'ollama';
  configured: boolean;
  ok:         boolean;
  latencyMs?: number;
  detail?:    string;
}

function applyHealth(prev: ProviderConfig[], rows: ApiProviderHealth[]): ProviderConfig[] {
  return prev.map((p) => {
    const row = rows.find((r) => r.provider === p.provider);
    if (!row) return p;
    let health: ProviderHealth;
    if (!row.configured) health = 'unconfigured';
    else if (row.ok)     health = 'ok';
    else                 health = 'error';
    return { ...p, health, latencyMs: row.latencyMs, detail: row.detail };
  });
}

function ModelsTab() {
  // Start in "checking" until the real /api/providers/health response lands.
  // Avoids the Phase 2.6 contradiction: card said "Unconfigured" while the
  // key was clearly in the vault and chat was working.
  const [providers, setProviders] = useState<ProviderConfig[]>(() =>
    STUB_PROVIDERS.map((p) => ({ ...p, health: 'checking', detail: undefined })),
  );
  const [checkingAll, setCheckingAll] = useState(false);

  const refreshHealth = useCallback(async () => {
    setCheckingAll(true);
    setProviders((prev) => prev.map((p) => ({ ...p, health: 'checking', detail: undefined })));
    try {
      const res = await apiFetch<{ providers: ApiProviderHealth[] }>(
        '/api/providers/health',
      );
      setProviders((prev) => applyHealth(prev, res.providers));
    } catch (err) {
      // Fail open with "error" rather than the misleading "Unconfigured"
      setProviders((prev) =>
        prev.map((p) => ({
          ...p,
          health: 'error',
          detail: err instanceof Error ? err.message : 'Healthcheck request failed',
        })),
      );
    } finally {
      setCheckingAll(false);
    }
  }, []);

  // Run once on mount so the page reflects real state immediately.
  useEffect(() => { void refreshHealth(); }, [refreshHealth]);

  async function handleCheckAll() {
    await refreshHealth();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          MiniMax + Ollama healthcheck. Keys live in the vault, never this UI.
        </p>
        <button
          className="abw-btn abw-btn--secondary abw-btn--sm"
          onClick={handleCheckAll}
          disabled={checkingAll}
          aria-label="Run healthcheck for all providers"
        >
          {checkingAll ? 'Checking…' : '↻ Check all'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>

      <div className="abw-banner abw-banner--info" role="note">
        <strong>No silent fallback.</strong> If a provider is unavailable, the run fails with a clear error.
        Fallback is opt-in per project and always surfaces a banner when used.
      </div>
    </div>
  );
}

function HealthIndicator({ health, latencyMs, detail }: Pick<ProviderConfig, 'health' | 'latencyMs' | 'detail'>) {
  const map: Record<ProviderHealth, { dot: string; label: string }> = {
    checking:    { dot: 'var(--warning-500)',  label: 'Checking…'    },
    ok:          { dot: 'var(--success-500)',  label: 'Online'       },
    error:       { dot: 'var(--error-500)',    label: 'Error'        },
    unconfigured:{ dot: 'var(--text-disabled)', label: 'Unconfigured' },
  };
  const { dot, label } = map[health];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dot }} aria-hidden />
      <span style={{ fontSize: '0.8125rem', color: health === 'ok' ? 'var(--success-500)' : 'var(--text-secondary)' }}>
        {label}{latencyMs != null ? ` — ${latencyMs}ms` : ''}
      </span>
      {detail && health !== 'ok' && (
        <span style={{ fontSize: '0.75rem', color: 'var(--error-500)' }}>{detail}</span>
      )}
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderConfig }) {
  return (
    <div className="abw-card" aria-label={provider.name}>
      <div className="abw-card__header">
        <div>
          <h3 className="abw-card__title">{provider.name}</h3>
          <HealthIndicator health={provider.health} latencyMs={provider.latencyMs} detail={provider.detail} />
        </div>
        <button className="abw-btn abw-btn--ghost abw-btn--sm" aria-label={`Configure ${provider.name}`}>
          Configure
        </button>
      </div>

      {provider.provider === 'ollama' && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <label className="abw-field-label" htmlFor={`base-url-${provider.id}`}>Base URL</label>
          <input
            id={`base-url-${provider.id}`}
            className="abw-input"
            type="url"
            defaultValue={provider.baseUrl}
            placeholder="http://localhost:11434"
          />
        </div>
      )}

      {provider.provider === 'minimax' && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <p className="abw-field-label">API key</p>
          <div className="abw-input" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
            <span aria-hidden>🔐</span>
            Stored in vault. <button className="abw-btn abw-btn--ghost abw-btn--sm" style={{ marginLeft: 'auto' }}>Update key</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 'var(--space-3)' }}>
        <p className="abw-field-label">Available models</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {provider.models.map((m) => (
            <li key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '0.8125rem' }}>
              <code style={{ background: 'var(--surface-elevated)', padding: '1px 6px', borderRadius: 'var(--radius-field)', fontSize: '0.75rem' }}>{m.id}</code>
              <span style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
              {m.id === provider.defaultModel && (
                <span className="abw-badge" style={{ marginLeft: 'auto' }}>default</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────────────

function DangerTab() {
  return (
    <div className="abw-card" style={{ borderColor: 'var(--error-300)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Delete all workspace data</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            Permanently deletes all projects, files, secrets, runs, and configurations for this workspace.
          </div>
        </div>
        <button className="abw-btn abw-btn--destructive" aria-label="Delete all workspace data">Delete workspace</button>
      </div>
    </div>
  );
}
