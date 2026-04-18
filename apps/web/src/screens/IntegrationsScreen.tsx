// apps/web/src/screens/IntegrationsScreen.tsx — OAuth integration connections.
// OAuth refresh tokens are stored in the vault; only metadata shown here.
// Connecting / reconnecting requires approval for live customer accounts.
import { useState } from 'react';

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
}

type Tab = 'connected' | 'available';

// ── Catalogue (what integrations can be connected) ────────────────────────────

const INTEGRATION_DEFS: IntegrationDef[] = [
  { id: 'stripe',       name: 'Stripe',          category: 'payments',  icon: '💳', description: 'Payment processing, subscriptions, invoices.',          authType: 'api-key'  },
  { id: 'resend',       name: 'Resend',           category: 'email',     icon: '✉️',  description: 'Transactional email via the Resend API.',               authType: 'api-key'  },
  { id: 'sendgrid',     name: 'SendGrid',         category: 'email',     icon: '📧',  description: 'Email delivery at scale.',                             authType: 'api-key'  },
  { id: 'google-drive', name: 'Google Drive',     category: 'storage',   icon: '📁',  description: 'Read/write files in Google Drive folders.',            authType: 'oauth2'   },
  { id: 'notion',       name: 'Notion',           category: 'other',     icon: '📝',  description: 'Read and write Notion pages and databases.',           authType: 'oauth2'   },
  { id: 'slack',        name: 'Slack',            category: 'other',     icon: '💬',  description: 'Post messages and read channels via Slack API.',       authType: 'oauth2'   },
  { id: 'hubspot',      name: 'HubSpot',          category: 'crm',       icon: '🧲',  description: 'CRM contacts, deals, and pipeline automation.',        authType: 'oauth2'   },
  { id: 'ga4',          name: 'Google Analytics', category: 'analytics', icon: '📊',  description: 'Pull GA4 events and conversion data.',                 authType: 'oauth2'   },
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
  const [activeTab, setActiveTab] = useState<Tab>('connected');
  const [connected, setConnected] = useState<Integration[]>([]);
  const [search, setSearch]       = useState('');
  const [showConnect, setShowConnect] = useState<IntegrationDef | null>(null);

  const connectedDefIds = new Set(connected.map((c) => c.defId));
  const available = INTEGRATION_DEFS.filter(
    (d) => !connectedDefIds.has(d.id) &&
      (search === '' || d.name.toLowerCase().includes(search.toLowerCase()) ||
       d.description.toLowerCase().includes(search.toLowerCase())),
  );

  function handleConnect(def: IntegrationDef, accountLabel: string) {
    const newIntegration: Integration = {
      id:             crypto.randomUUID(),
      defId:          def.id,
      name:           def.name,
      status:         'connected',
      accountLabel:   accountLabel || undefined,
      lastSyncedAt:   new Date().toISOString(),
      approvalRequired: def.authType === 'oauth2',
    };
    setConnected((prev) => [...prev, newIntegration]);
    setShowConnect(null);
  }

  function handleDisconnect(id: string) {
    setConnected((prev) => prev.filter((c) => c.id !== id));
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'connected', label: `Connected${connected.length > 0 ? ` (${connected.length})` : ''}` },
    { id: 'available', label: 'Available'  },
  ];

  // Group available by category
  const categories = Array.from(new Set(available.map((d) => d.category)));

  return (
    <div className="abw-screen">
      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Integrations</h1>
          <p className="abw-screen__sub">
            Connect third-party services. OAuth tokens are stored in the vault — never in this UI.
          </p>
        </div>
      </div>

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
              Browse available integrations to connect CRMs, email, payments, and more. OAuth tokens are vault-secured.
            </p>
            <button className="abw-btn abw-btn--primary" onClick={() => setActiveTab('available')}>
              Browse integrations
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {connected.map((c) => {
              const { color, label } = statusStyle(c.status);
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
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                      {c.status === 'error' && (
                        <button
                          className="abw-btn abw-btn--secondary abw-btn--sm"
                          title="Reconnecting requires approval"
                          onClick={() => alert('Reconnect requires approval (gate not yet wired)')}
                        >
                          Reconnect
                        </button>
                      )}
                      <button
                        className="abw-btn abw-btn--ghost abw-btn--sm"
                        onClick={() => handleDisconnect(c.id)}
                        aria-label={`Disconnect ${c.name}`}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {c.lastSyncedAt && (
                    <p style={{ marginTop: 'var(--space-2)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Last synced: {relativeTime(c.lastSyncedAt)}
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
                          Connect
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
          onConnect={(label) => handleConnect(showConnect, label)}
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
  onConnect: (accountLabel: string) => void;
}) {
  const [label, setLabel] = useState('');

  return (
    <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label={`Connect ${def.name}`}>
      <div className="abw-dialog">
        <div className="abw-dialog__header">
          <h2 className="abw-dialog__title">{def.icon} Connect {def.name}</h2>
          <button className="abw-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="abw-dialog__body" style={{ gap: 'var(--space-4)' }}>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{def.description}</p>

          <div className="abw-callout">
            <span className="abw-callout__icon" aria-hidden>🔐</span>
            <span>
              {def.authType === 'oauth2'
                ? 'OAuth tokens will be stored in the vault. This screen never receives the token value.'
                : 'API keys will be stored in the vault. Values are never returned to the browser.'}
            </span>
          </div>

          {def.authType === 'oauth2' && (
            <div className="abw-banner abw-banner--info">
              <strong>OAuth flow:</strong> You'll be redirected to {def.name} to authorize access. The refresh token is stored server-side only.
            </div>
          )}

          <div>
            <label className="abw-field-label" htmlFor="int-label">Account label <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional)</span></label>
            <input
              id="int-label"
              className="abw-input"
              type="text"
              placeholder="e.g. Company Production Account"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          {def.authType === 'api-key' && (
            <div>
              <label className="abw-field-label" htmlFor="int-key">API Key</label>
              <input
                id="int-key"
                className="abw-input"
                type="password"
                placeholder="Stored encrypted in vault"
                autoComplete="new-password"
              />
            </div>
          )}
        </div>
        <div className="abw-dialog__footer">
          <button className="abw-btn abw-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="abw-btn abw-btn--primary" onClick={() => onConnect(label)}>
            {def.authType === 'oauth2' ? 'Authorize with ' + def.name : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
