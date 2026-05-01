// apps/web/src/screens/IntegrationsScreen.tsx — OAuth integration connections.
// API keys stored in vault server-side; OAuth stubbed with "coming soon."
// All connection state is authoritative from the backend — no local-only state.
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, ApiError } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type IntegrationStatus = 'connected' | 'error' | 'disconnected' | 'pending';

interface IntegrationDef {
  id:          string;
  name:        string;
  category:    'crm' | 'email' | 'payments' | 'analytics' | 'storage' | 'other';
  icon:        string;
  description: string;
  authType:    'oauth2' | 'api-key' | 'webhook';
  docUrl?:     string;
}

interface Integration {
  id:            string;
  defId:         string;
  name:          string;
  status:        IntegrationStatus;
  accountLabel?: string;
  lastSyncedAt?: string;
  errorMessage?: string;
  approvalRequired: boolean;
  testLatencyMs?: number;
}

type Tab = 'connected' | 'available';

// ── API response types ────────────────────────────────────────────────────────

interface APIIntegration {
  id:            string;
  integrationId: string;
  name:          string;
  accountLabel?: string;
  authType:      string;
  status:        string;
  connectedAt?:  string;
}

// ── Catalogue ─────────────────────────────────────────────────────────────────

const INTEGRATION_DEFS: IntegrationDef[] = [
  { id: 'stripe',       name: 'Stripe',          category: 'payments',  icon: '💳', description: 'Payment processing, subscriptions, invoices.',        authType: 'api-key' },
  { id: 'resend',       name: 'Resend',           category: 'email',     icon: '✉️',  description: 'Transactional email via the Resend API.',             authType: 'api-key' },
  { id: 'sendgrid',     name: 'SendGrid',         category: 'email',     icon: '📧',  description: 'Email delivery at scale.',                           authType: 'api-key' },
  { id: 'google-drive', name: 'Google Drive',     category: 'storage',   icon: '📁',  description: 'Read/write files in Google Drive folders.',          authType: 'oauth2'  },
  { id: 'notion',       name: 'Notion',           category: 'other',     icon: '📝',  description: 'Read and write Notion pages and databases.',         authType: 'oauth2'  },
  { id: 'slack',        name: 'Slack',            category: 'other',     icon: '💬',  description: 'Post messages and read channels via Slack API.',     authType: 'oauth2'  },
  { id: 'hubspot',      name: 'HubSpot',          category: 'crm',       icon: '🧲',  description: 'CRM contacts, deals, and pipeline automation.',      authType: 'oauth2'  },
  { id: 'ga4',          name: 'Google Analytics', category: 'analytics', icon: '📊',  description: 'Pull GA4 events and conversion data.',               authType: 'oauth2'  },
];

const CATEGORY_LABELS: Record<string, string> = {
  crm: 'CRM', email: 'Email', payments: 'Payments', analytics: 'Analytics', storage: 'Storage', other: 'Other',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  if (m < 2)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusStyle(s: IntegrationStatus): { color: string; label: string } {
  switch (s) {
    case 'connected':    return { color: 'var(--success-500)', label: 'Connected'    };
    case 'error':        return { color: 'var(--error-500)',   label: 'Error'        };
    case 'pending':      return { color: 'var(--warning-500)', label: 'Pending'      };
    case 'disconnected': return { color: 'var(--text-secondary)', label: 'Disconnected' };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IntegrationsScreen() {
  const [activeTab, setActiveTab]     = useState<Tab>('connected');
  const [connected, setConnected]     = useState<Integration[]>([]);
  const [search, setSearch]           = useState('');
  const [showConnect, setShowConnect] = useState<IntegrationDef | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [testingId, setTestingId]     = useState<string | null>(null);

  // ── Fetch connected integrations on mount ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ integrations: APIIntegration[] }>('/api/integrations')
      .then((res) => {
        if (cancelled) return;
        setConnected(res.integrations.map((i) => ({
          id:               i.id,
          defId:            i.integrationId,
          name:             i.name,
          status:           (i.status as IntegrationStatus) || 'connected',
          accountLabel:     i.accountLabel,
          lastSyncedAt:     i.connectedAt,
          approvalRequired: i.authType === 'oauth2',
        })));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load integrations.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const connectedDefIds = new Set(connected.map((c) => c.defId));
  const available = INTEGRATION_DEFS.filter(
    (d) => !connectedDefIds.has(d.id) &&
      (search === '' || d.name.toLowerCase().includes(search.toLowerCase()) ||
       d.description.toLowerCase().includes(search.toLowerCase())),
  );

  // ── Connect ───────────────────────────────────────────────────────────────
  async function handleConnect(def: IntegrationDef, accountLabel: string, apiKey: string) {
    const def2 = def; // capture for closure
    try {
      const res = await apiFetch<{ integration: APIIntegration }>('/api/integrations', {
        method: 'POST',
        body: JSON.stringify({
          integrationId: def2.id,
          name:          def2.name,
          accountLabel:  accountLabel || undefined,
          apiKey:        apiKey || undefined,
          authType:      def2.authType,
          env:           'dev',
        }),
      });
      setConnected((prev) => [...prev, {
        id:               res.integration.id,
        defId:            def2.id,
        name:             def2.name,
        status:           'connected',
        accountLabel:     accountLabel || undefined,
        lastSyncedAt:     res.integration.connectedAt ?? new Date().toISOString(),
        approvalRequired: def2.authType === 'oauth2',
      }]);
      setShowConnect(null);
    } catch (err) {
      alert(`Failed to connect: ${err instanceof ApiError ? err.message : 'Server error'}`);
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────
  async function handleDisconnect(id: string) {
    if (!confirm('Disconnect this integration?')) return;
    try {
      await apiFetch(`/api/integrations/${id}`, { method: 'DELETE' });
      setConnected((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      alert(`Failed: ${err instanceof ApiError ? err.message : 'Server error'}`);
    }
  }

  // ── Test ──────────────────────────────────────────────────────────────────
  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const res = await apiFetch<{ ok: boolean; latencyMs: number; detail?: string }>(
        `/api/integrations/${id}/test`,
        { method: 'POST' },
      );
      setConnected((prev) => prev.map((c) =>
        c.id === id
          ? { ...c, status: res.ok ? 'connected' : 'error', testLatencyMs: res.latencyMs, errorMessage: res.ok ? undefined : (res.detail ?? 'Test failed') }
          : c,
      ));
    } catch (err) {
      setConnected((prev) => prev.map((c) =>
        c.id === id ? { ...c, status: 'error', errorMessage: err instanceof ApiError ? err.message : 'Test failed' } : c,
      ));
    } finally {
      setTestingId(null);
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'connected', label: `Connected${connected.length > 0 ? ` (${connected.length})` : ''}` },
    { id: 'available', label: 'Available' },
  ];

  const categories = Array.from(new Set(available.map((d) => d.category)));

  return (
    <div className="abw-screen">
      {/* Error banner */}
      {error && (
        <div className="abw-banner abw-banner--warning" style={{ marginBottom: 'var(--space-4)' }}>
          ⚠ {error}
          <button className="abw-btn abw-btn--ghost abw-btn--xs" style={{ marginLeft: 'auto' }} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Integrations</h1>
          <p className="abw-screen__sub">
            {loading
              ? 'Loading…'
              : 'Connect third-party services. API keys are stored in the vault — never in this UI.'}
          </p>
        </div>
      </div>

      {/* Premium gen — Higgsfield */}
      <HiggsfieldCard onError={(msg) => setError(msg)} />

      {/* Tabs */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Integrations sections">
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

      {/* ── Connected tab ── */}
      {activeTab === 'connected' && (
        connected.length === 0 ? (
          <div className="abw-empty-state">
            <span className="abw-empty-state__icon" aria-hidden>🔌</span>
            <p className="abw-empty-state__label">No integrations connected</p>
            <p className="abw-empty-state__sub">
              Browse available integrations to connect CRMs, email, payments, and more. API keys are vault-secured.
            </p>
            <button className="abw-btn abw-btn--primary" onClick={() => setActiveTab('available')}>
              Browse integrations
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {connected.map((c) => {
              const { color, label } = statusStyle(c.status);
              const isTesting = testingId === c.id;
              return (
                <div key={c.id} className="abw-card">
                  <div className="abw-card__header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span style={{ fontSize: '1.5rem' }} aria-hidden>
                        {INTEGRATION_DEFS.find((d) => d.id === c.defId)?.icon ?? '🔌'}
                      </span>
                      <div>
                        <h2 className="abw-card__title" style={{ marginBottom: 2 }}>{c.name}</h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <span style={{ fontSize: '0.6875rem', color, fontWeight: 600 }}>● {label}</span>
                          {c.accountLabel && (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                              · {c.accountLabel}
                            </span>
                          )}
                          {c.testLatencyMs !== undefined && c.status === 'connected' && (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>
                              {c.testLatencyMs}ms
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                      <button
                        className="abw-btn abw-btn--ghost abw-btn--sm"
                        disabled={isTesting}
                        onClick={() => void handleTest(c.id)}
                        aria-label={`Test ${c.name}`}
                      >
                        {isTesting ? 'Testing…' : 'Test'}
                      </button>
                      <button
                        className="abw-btn abw-btn--ghost abw-btn--sm"
                        onClick={() => void handleDisconnect(c.id)}
                        aria-label={`Disconnect ${c.name}`}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {c.lastSyncedAt && (
                    <p style={{ marginTop: 'var(--space-2)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Connected: {relativeTime(c.lastSyncedAt)}
                    </p>
                  )}

                  {c.errorMessage && (
                    <div className="abw-banner abw-banner--error" style={{ marginTop: 'var(--space-3)' }}>
                      {c.errorMessage}
                    </div>
                  )}

                  {c.approvalRequired && (
                    <div className="abw-callout" style={{ marginTop: 'var(--space-3)' }}>
                      <span className="abw-callout__icon">🔐</span>
                      Reconnecting or rotating credentials requires approval. Tokens are vault-secured.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Available tab ── */}
      {activeTab === 'available' && (
        <>
          <input
            className="abw-input"
            type="search"
            placeholder="Search integrations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search integrations"
            style={{ maxWidth: 320 }}
          />

          {available.length === 0 ? (
            <div className="abw-empty-state">
              <span className="abw-empty-state__icon" aria-hidden>🔍</span>
              <p className="abw-empty-state__label">No integrations match &ldquo;{search}&rdquo;</p>
              <p className="abw-empty-state__sub">Try a different name or category.</p>
            </div>
          ) : (
            categories.map((cat) => {
              const items = available.filter((d) => d.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat}>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-2)' }}>
                    {CATEGORY_LABELS[cat] ?? cat}
                  </p>
                  <div className="abw-integrations-grid">
                    {items.map((def) => (
                      <div key={def.id} className="abw-integration-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                          <span style={{ fontSize: '1.25rem' }} aria-hidden>{def.icon}</span>
                          <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{def.name}</span>
                          <span className="abw-badge" style={{ marginLeft: 'auto', fontSize: '0.625rem' }}>{def.authType}</span>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)', flex: 1 }}>
                          {def.description}
                        </p>
                        <button
                          className="abw-btn abw-btn--secondary abw-btn--sm"
                          onClick={() => setShowConnect(def)}
                          style={{ width: '100%' }}
                        >
                          {def.authType === 'oauth2' ? 'Connect (OAuth)' : 'Connect'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </>
      )}

      {/* Connect dialog */}
      {showConnect && (
        <ConnectDialog
          def={showConnect}
          onClose={() => setShowConnect(null)}
          onConnect={(label, apiKey) => void handleConnect(showConnect, label, apiKey)}
        />
      )}
    </div>
  );
}

// ── ConnectDialog ─────────────────────────────────────────────────────────────

function ConnectDialog({
  def,
  onClose,
  onConnect,
}: {
  def:       IntegrationDef;
  onClose:   () => void;
  onConnect: (accountLabel: string, apiKey: string) => void;
}) {
  const [label,  setLabel]  = useState('');
  const [apiKey, setApiKey] = useState('');

  const isOAuth = def.authType === 'oauth2';

  return (
    <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label={`Connect ${def.name}`}>
      <div className="abw-dialog">
        <div className="abw-dialog__header">
          <h2 className="abw-dialog__title">{def.icon} Connect {def.name}</h2>
          <button className="abw-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="abw-dialog__body" style={{ gap: 'var(--space-4)' }}>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{def.description}</p>

          {isOAuth ? (
            <>
              <div className="abw-banner abw-banner--info">
                <strong>OAuth coming soon.</strong> Full OAuth flows are not yet wired. If {def.name} provides an API key or access token, use that below instead — or check back later.
              </div>
              <div className="abw-callout">
                <span className="abw-callout__icon" aria-hidden>🔐</span>
                <span>OAuth tokens will be stored in the vault server-side. This screen never receives the token value.</span>
              </div>
            </>
          ) : (
            <div className="abw-callout">
              <span className="abw-callout__icon" aria-hidden>🔐</span>
              <span>Your API key will be encrypted and stored in the vault. It is never returned to the browser.</span>
            </div>
          )}

          <div>
            <label className="abw-field-label" htmlFor="int-label">
              Account label{' '}
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              id="int-label"
              className="abw-input"
              type="text"
              placeholder="e.g. Company Production Account"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div>
            <label className="abw-field-label" htmlFor="int-key">
              {isOAuth ? 'Access Token / API Key' : 'API Key'}
            </label>
            <input
              id="int-key"
              className="abw-input"
              type="password"
              placeholder="Stored encrypted in vault"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        </div>
        <div className="abw-dialog__footer">
          <button className="abw-btn abw-btn--ghost" onClick={onClose}>Cancel</button>
          <button
            className="abw-btn abw-btn--primary"
            disabled={!apiKey.trim()}
            onClick={() => onConnect(label, apiKey)}
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Higgsfield (premium gen MCP) — separate flow with its own endpoints ───────

interface HiggsfieldStatus {
  connected:    boolean;
  connectedAt?: string;
  error?:       string;
}

interface HiggsfieldTestResult {
  ok:         boolean;
  toolCount:  number;
  categories: { images: number; videos: number; audio: number; characters: number; history: number };
  sample:     { name: string; description?: string }[];
}

function HiggsfieldCard({ onError }: { onError: (msg: string) => void }) {
  const [status, setStatus] = useState<HiggsfieldStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastTest, setLastTest] = useState<HiggsfieldTestResult | null>(null);
  const popupRef = useRef<Window | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await apiFetch<HiggsfieldStatus>('/api/higgsfield/status');
      setStatus(s);
    } catch {
      setStatus({ connected: false });
    }
  }, []);

  // Initial status load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshStatus().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshStatus]);

  // Listen for the OAuth popup's postMessage
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (typeof e.data !== 'object' || !e.data || e.data.source !== 'abw-higgsfield-oauth') return;
      if (e.data.ok) {
        // Give the server a moment to commit the token write, then refresh.
        setTimeout(() => { void refreshStatus(); }, 500);
      } else {
        onError('Higgsfield connection was not completed.');
      }
      try { popupRef.current?.close(); } catch { /* */ }
      popupRef.current = null;
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refreshStatus, onError]);

  async function handleConnect() {
    setBusy(true);
    try {
      const r = await apiFetch<{ authorized: boolean; authUrl?: string; state: string }>(
        '/api/higgsfield/oauth/start',
        { method: 'POST', body: '{}' },
      );
      if (r.authorized) {
        // Already had valid tokens — just refresh status.
        void refreshStatus();
        return;
      }
      if (!r.authUrl) {
        onError('Server did not return an authorization URL');
        return;
      }
      // Open Higgsfield's authorization page in a popup. User signs in there.
      const w = 480, h = 720;
      const left = window.screenX + (window.outerWidth  - w) / 2;
      const top  = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(r.authUrl, 'higgsfield-oauth',
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
      if (!popup) {
        onError('Popup blocked — allow popups for this site and click Connect again.');
        return;
      }
      popupRef.current = popup;
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not start OAuth flow');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Higgsfield? You can reconnect any time.')) return;
    setBusy(true);
    try {
      await apiFetch('/api/higgsfield/connection', { method: 'DELETE' });
      setStatus({ connected: false });
      setLastTest(null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    try {
      const r = await apiFetch<HiggsfieldTestResult>('/api/higgsfield/test', { method: 'POST', body: '{}' });
      setLastTest(r);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Test failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="abw-card" style={{ marginBottom: 'var(--space-4)', borderColor: status.connected ? 'var(--accent-300)' : 'var(--border-base)' }}>
      <div className="abw-card__header" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span style={{ fontSize: '1.5rem' }} aria-hidden>🎬</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <strong style={{ fontSize: '0.9375rem' }}>Higgsfield Premium Gen</strong>
            <span style={{ fontSize: '0.625rem', padding: '1px 6px', borderRadius: 'var(--radius-pill)', background: 'var(--accent-100)', color: 'var(--accent-700)' }}>MCP · OAuth</span>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            30+ models for image &amp; video — Sora 2, Veo 3.1, Kling 3.0, Hailuo 02, Flux 2, Soul. Connect once with your Higgsfield account; the chat agent uses it (with the 🎬 toggle on) and the Video Studio uses it directly.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {loading ? (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Loading…</span>
          ) : status.connected ? (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--success-500)', fontWeight: 600 }}>
                <span aria-hidden>●</span> Connected
              </span>
              <button className="abw-btn abw-btn--ghost abw-btn--xs" onClick={() => void handleTest()} disabled={busy}>Test</button>
              <button className="abw-btn abw-btn--ghost abw-btn--xs" onClick={() => void handleConnect()} disabled={busy} title="Re-authenticate (e.g. after token expiry or to switch accounts)">Reconnect</button>
              <button className="abw-btn abw-btn--ghost abw-btn--xs abw-btn--destructive" onClick={() => void handleDisconnect()} disabled={busy}>Disconnect</button>
            </>
          ) : (
            <button className="abw-btn abw-btn--primary abw-btn--sm" onClick={() => void handleConnect()} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect with Higgsfield'}
            </button>
          )}
        </div>
      </div>
      {lastTest && (
        <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--border-base)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          ✓ {lastTest.toolCount} tools — {lastTest.categories.images} images · {lastTest.categories.videos} videos · {lastTest.categories.audio} audio · {lastTest.categories.characters} characters
          {lastTest.sample.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>Sample tool names</summary>
              <ul style={{ margin: '4px 0 0 16px', padding: 0, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.6875rem' }}>
                {lastTest.sample.map((t) => (
                  <li key={t.name} style={{ marginBottom: 2 }}>{t.name}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
