// apps/web/src/screens/ProviderSettingsScreen.tsx — provider configuration.
// Shows MiniMax + Ollama healthcheck status, model lists, and connection settings.
// API keys are stored in vault — this screen never handles or displays raw key values.
import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Stub data (healthcheck called via /api/providers/healthcheck in Step 4) ───

const STUB_PROVIDERS: ProviderConfig[] = [
  {
    id: '1', provider: 'minimax', name: 'MiniMax 2.7',
    defaultModel: 'abab6.5s-chat',
    health: 'unconfigured', detail: 'No API key configured. Add the key via Secrets.',
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
      { id: 'llama3',       label: 'LLaMA 3 (8B)' },
      { id: 'mistral',      label: 'Mistral 7B'   },
      { id: 'codestral',    label: 'Codestral'    },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function ProviderSettingsScreen() {
  const [providers, setProviders] = useState<ProviderConfig[]>(STUB_PROVIDERS);
  const [checkingAll, setCheckingAll] = useState(false);

  async function handleCheckAll() {
    setCheckingAll(true);
    setProviders((prev) => prev.map((p) => ({ ...p, health: 'checking' })));
    // TODO: POST /api/providers/healthcheck-all
    await new Promise((r) => setTimeout(r, 1200));
    setProviders((prev) => prev.map((p) => ({
      ...p,
      health: p.provider === 'ollama' ? 'ok' : 'unconfigured',
      latencyMs: p.provider === 'ollama' ? 42 : undefined,
    })));
    setCheckingAll(false);
  }

  return (
    <div className="abw-screen">
      {/* Page header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">AI Providers</h1>
          <p className="abw-screen__sub">Configure MiniMax 2.7 and Ollama. API keys are stored in vault — never in this UI.</p>
        </div>
        <button
          className="abw-btn abw-btn--secondary"
          onClick={handleCheckAll}
          disabled={checkingAll}
          aria-label="Run healthcheck for all providers"
        >
          {checkingAll ? 'Checking…' : '↻ Check all'}
        </button>
      </div>

      {/* Provider cards */}
      <div className="abw-provider-list">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>

      {/* Fallback policy notice */}
      <div className="abw-banner abw-banner--info" role="note" style={{ marginTop: 'var(--space-6)' }}>
        <strong>No silent fallback.</strong> If a provider is unavailable, the run fails with a clear error. Fallback is opt-in per project and always shows a warning banner when used.
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthIndicator({ health, latencyMs, detail }: Pick<ProviderConfig, 'health' | 'latencyMs' | 'detail'>) {
  const map: Record<ProviderHealth, { dot: string; label: string }> = {
    checking:    { dot: 'var(--warning-500)', label: 'Checking…'     },
    ok:          { dot: 'var(--success-500)', label: 'Online'        },
    error:       { dot: 'var(--error-500)',   label: 'Error'         },
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
          <h2 className="abw-card__title">{provider.name}</h2>
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
          <p className="abw-field-label">API Key</p>
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
