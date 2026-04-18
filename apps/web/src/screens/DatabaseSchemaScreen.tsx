// apps/web/src/screens/DatabaseSchemaScreen.tsx — schema editor, migration manager, DB browser.
// Schema definitions live in the `schemas` table; migrations in `migrations`.
// Staging/prod apply is approval-gated (server enforces; UI surfaces the gate).
// DB Browser: live table viewer + SQL editor via /api/db routes.
import { useState, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type MigrationStatus = 'pending' | 'applied' | 'rolled_back' | 'failed';
type MigrationEnv    = 'dev' | 'staging' | 'preview' | 'production';

interface SchemaTable {
  id:         string;
  name:       string;
  definition: { columns: ColumnDef[] };
}

interface ColumnDef {
  name:     string;
  type:     string;
  notNull:  boolean;
  default?: string;
}

interface Migration {
  id:       string;
  name:     string;
  env:      MigrationEnv;
  status:   MigrationStatus;
  appliedAt: string | null;
  sql:      string;
}

// ── Stub data (replaced by API queries in Step 9) ─────────────────────────────

const STUB_TABLES: SchemaTable[] = [
  {
    id: '1', name: 'users',
    definition: {
      columns: [
        { name: 'id',         type: 'uuid',    notNull: true,  default: 'gen_random_uuid()' },
        { name: 'email',      type: 'text',    notNull: true                                },
        { name: 'name',       type: 'text',    notNull: false                               },
        { name: 'created_at', type: 'timestamp', notNull: true, default: 'now()'            },
      ],
    },
  },
  {
    id: '2', name: 'orders',
    definition: {
      columns: [
        { name: 'id',         type: 'uuid',    notNull: true,  default: 'gen_random_uuid()' },
        { name: 'user_id',    type: 'uuid',    notNull: true                                },
        { name: 'amount',     type: 'integer', notNull: true                                },
        { name: 'status',     type: 'text',    notNull: true,  default: "'pending'"         },
      ],
    },
  },
];

const STUB_MIGRATIONS: Migration[] = [
  { id: '1', name: '001_create_users',  env: 'dev',  status: 'applied',  appliedAt: '2026-04-10T09:00:00Z', sql: 'CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, name text, created_at timestamptz NOT NULL DEFAULT now());' },
  { id: '2', name: '002_create_orders', env: 'dev',  status: 'applied',  appliedAt: '2026-04-12T14:00:00Z', sql: 'CREATE TABLE orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), amount integer NOT NULL, status text NOT NULL DEFAULT \'pending\');' },
  { id: '3', name: '003_add_index',     env: 'dev',  status: 'pending',  appliedAt: null,                   sql: 'CREATE INDEX orders_user_id_idx ON orders(user_id);' },
  { id: '4', name: '001_create_users',  env: 'staging', status: 'pending', appliedAt: null,                 sql: 'CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, name text, created_at timestamptz NOT NULL DEFAULT now());' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: MigrationStatus) {
  const map: Record<MigrationStatus, { label: string; color: string }> = {
    pending:     { label: 'Pending',     color: 'var(--text-secondary)' },
    applied:     { label: 'Applied',     color: 'var(--success-500)'    },
    rolled_back: { label: 'Rolled back', color: 'var(--warning-500)'   },
    failed:      { label: 'Failed',      color: 'var(--error-500)'      },
  };
  const { label, color } = map[status];
  return <span style={{ color, fontSize: '0.75rem', fontWeight: 600 }}>{label}</span>;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Tab = 'schema' | 'migrations' | 'browser';
const ENV_ORDER: MigrationEnv[] = ['dev', 'staging', 'preview', 'production'];

export function DatabaseSchemaScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('schema');
  const [selectedTable, setSelectedTable] = useState<SchemaTable | null>(STUB_TABLES[0] ?? null);
  const [activeEnv, setActiveEnv] = useState<MigrationEnv>('dev');
  const [expandedSql, setExpandedSql] = useState<string | null>(null);

  const visibleMigrations = STUB_MIGRATIONS.filter((m) => m.env === activeEnv);

  return (
    <div className="abw-screen">
      {/* Page header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Database</h1>
          <p className="abw-screen__sub">Schema editor, migration management, and live table browser. Staging/production changes require approval.</p>
        </div>
        {activeTab === 'schema' && (
          <button className="abw-btn abw-btn--primary" aria-label="Add table">+ Add table</button>
        )}
        {activeTab === 'migrations' && (
          <button className="abw-btn abw-btn--primary" aria-label="New migration">+ New migration</button>
        )}
      </div>

      {/* Main tabs: Schema / Migrations / Browser */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Database views">
        {([['schema', 'Schema'], ['migrations', 'Migrations'], ['browser', 'Browser']] as [Tab, string][]).map(([id, label]) => (
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

      {/* Schema view */}
      {activeTab === 'schema' && (
        <div className="abw-db-layout">
          {/* Table list */}
          <aside className="abw-db-layout__sidebar" aria-label="Tables">
            {STUB_TABLES.length === 0 ? (
              <p style={{ padding: 'var(--space-3)', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No tables yet.</p>
            ) : (
              <ul className="abw-db-layout__table-list" role="listbox" aria-label="Database tables">
                {STUB_TABLES.map((t) => (
                  <li key={t.id}>
                    <button
                      className={`abw-db-layout__table-item${selectedTable?.id === t.id ? ' abw-db-layout__table-item--active' : ''}`}
                      onClick={() => setSelectedTable(t)}
                      role="option"
                      aria-selected={selectedTable?.id === t.id}
                    >
                      {t.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* Column editor */}
          <div className="abw-db-layout__content">
            {selectedTable ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
                  <h2 style={{ fontWeight: 600, fontSize: '1rem' }}>{selectedTable.name}</h2>
                  <button className="abw-btn abw-btn--ghost abw-btn--sm">+ Add column</button>
                </div>
                <div className="abw-table-wrap">
                  <table className="abw-table" aria-label={`${selectedTable.name} columns`}>
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Not null</th>
                        <th>Default</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTable.definition.columns.map((col) => (
                        <tr key={col.name}>
                          <td><code style={{ fontSize: '0.8125rem' }}>{col.name}</code></td>
                          <td><span className="abw-badge">{col.type}</span></td>
                          <td>{col.notNull ? '✓' : '—'}</td>
                          <td style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                            {col.default ?? '—'}
                          </td>
                          <td>
                            <button className="abw-btn abw-btn--ghost abw-btn--sm" aria-label={`Edit column ${col.name}`}>Edit</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
                  <button className="abw-btn abw-btn--secondary">Preview migration SQL</button>
                  <button className="abw-btn abw-btn--ghost">Generate Drizzle schema</button>
                </div>
              </>
            ) : (
              <div className="abw-empty-state">
                <p className="abw-empty-state__label">Select a table</p>
                <p className="abw-empty-state__sub">Pick a table from the list to view and edit its columns.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Migrations view */}
      {activeTab === 'migrations' && (
        <>
          {/* Env filter */}
          <div className="abw-screen__tabs" role="tablist" aria-label="Migration environments" style={{ marginBottom: 'var(--space-4)' }}>
            {ENV_ORDER.map((env) => (
              <button
                key={env}
                role="tab"
                aria-selected={activeEnv === env}
                className={`abw-screen__tab${activeEnv === env ? ' abw-screen__tab--active' : ''}`}
                onClick={() => setActiveEnv(env)}
              >
                {env.charAt(0).toUpperCase() + env.slice(1)}
              </button>
            ))}
          </div>

          {(activeEnv === 'staging' || activeEnv === 'production') && (
            <div className="abw-banner abw-banner--warning" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
              <strong>Approval required</strong> — applying migrations to {activeEnv} requires an approved action.
            </div>
          )}

          {visibleMigrations.length === 0 ? (
            <div className="abw-empty-state">
              <span className="abw-empty-state__icon" aria-hidden>🗄</span>
              <p className="abw-empty-state__label">No migrations for {activeEnv}</p>
              <p className="abw-empty-state__sub">Create a migration from the Schema editor or manually write SQL.</p>
            </div>
          ) : (
            <div className="abw-table-wrap">
              <table className="abw-table" aria-label="Migrations">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Applied</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleMigrations.map((m) => (
                    <>
                      <tr key={m.id}>
                        <td>
                          <button
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)', fontSize: '0.875rem' }}
                            onClick={() => setExpandedSql(expandedSql === m.id ? null : m.id)}
                            aria-expanded={expandedSql === m.id}
                          >
                            <code>{m.name}</code>
                            <span style={{ marginLeft: 'var(--space-1)', color: 'var(--text-secondary)' }}>{expandedSql === m.id ? '▲' : '▼'}</span>
                          </button>
                        </td>
                        <td>{statusBadge(m.status)}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                          {m.appliedAt ? new Date(m.appliedAt).toLocaleDateString() : '—'}
                        </td>
                        <td>
                          <div className="abw-table__actions">
                            {m.status === 'pending' && (
                              <button className="abw-btn abw-btn--primary abw-btn--sm">
                                {activeEnv === 'staging' || activeEnv === 'production' ? 'Request approval' : 'Apply'}
                              </button>
                            )}
                            {m.status === 'applied' && (
                              <button className="abw-btn abw-btn--ghost abw-btn--sm">Rollback</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedSql === m.id && (
                        <tr key={`${m.id}-sql`}>
                          <td colSpan={4} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--surface-code)' }}>
                            <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>{m.sql}</pre>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* DB Browser tab */}
      {activeTab === 'browser' && <DbBrowser />}
    </div>
  );
}

// ── DB Browser ────────────────────────────────────────────────────────────────

interface QueryResult {
  columns: string[];
  rows:    unknown[][];
  rowCount: number;
  durationMs: number;
  error?: string;
}

function DbBrowser() {
  const [sql, setSql]             = useState('SELECT * FROM users LIMIT 50;');
  const [result, setResult]       = useState<QueryResult | null>(null);
  const [running, setRunning]     = useState(false);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const textareaRef               = useRef<HTMLTextAreaElement>(null);

  async function runQuery() {
    if (!sql.trim() || running) return;
    setRunning(true);
    const t0 = Date.now();
    try {
      const res = await fetch('/api/db/query', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          projectId: '00000000-0000-0000-0000-000000000000',
          sql:       sql.trim(),
          readOnly:  true,
        }),
      });
      const data = await res.json() as { rows?: unknown[][]; columns?: string[]; error?: string };
      if (data.error) {
        setResult({ columns: [], rows: [], rowCount: 0, durationMs: Date.now() - t0, error: data.error });
      } else {
        setResult({ columns: data.columns ?? [], rows: data.rows ?? [], rowCount: (data.rows ?? []).length, durationMs: Date.now() - t0 });
      }
    } catch (err: unknown) {
      setResult({ columns: [], rows: [], rowCount: 0, durationMs: Date.now() - t0, error: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setRunning(false);
    }
  }

  function loadTable(name: string) {
    setSelectedTable(name);
    setSql(`SELECT * FROM ${name} LIMIT 100;`);
    setResult(null);
  }

  return (
    <div className="abw-db-browser">
      {/* Sidebar: quick table list */}
      <aside className="abw-db-browser__sidebar" aria-label="Quick table access">
        <div className="abw-db-browser__sidebar-label">Tables</div>
        {STUB_TABLES.map((t) => (
          <button
            key={t.id}
            className={`abw-db-browser__table-btn${selectedTable === t.name ? ' abw-db-browser__table-btn--active' : ''}`}
            onClick={() => loadTable(t.name)}
            aria-pressed={selectedTable === t.name}
          >
            {t.name}
          </button>
        ))}
      </aside>

      {/* Main: SQL editor + results */}
      <div className="abw-db-browser__main">
        {/* SQL editor */}
        <div className="abw-db-browser__editor-wrap">
          <textarea
            ref={textareaRef}
            className="abw-db-browser__editor"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void runQuery();
              }
            }}
            aria-label="SQL query editor"
            spellCheck={false}
            rows={5}
          />
          <div className="abw-db-browser__editor-footer">
            <span className="abw-db-browser__editor-hint">⌘↵ to run · read-only queries only</span>
            <button
              className="abw-btn abw-btn--primary abw-btn--sm"
              onClick={() => void runQuery()}
              disabled={running || !sql.trim()}
              aria-busy={running}
            >
              {running ? 'Running…' : '▶ Run'}
            </button>
          </div>
        </div>

        {/* Results */}
        {!result && !running && (
          <div className="abw-db-browser__empty">
            <span aria-hidden style={{ fontSize: '1.5rem', opacity: 0.3 }}>🗄</span>
            <p>Run a query to see results.</p>
          </div>
        )}

        {result && (
          <div className="abw-db-browser__results">
            {result.error ? (
              <div className="abw-banner abw-banner--error" role="alert">
                <strong>Query error</strong><br />
                <code style={{ fontSize: '0.8125rem' }}>{result.error}</code>
              </div>
            ) : (
              <>
                <div className="abw-db-browser__results-meta">
                  {result.rowCount} row{result.rowCount !== 1 ? 's' : ''} · {result.durationMs}ms
                </div>
                {result.columns.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No rows returned.</p>
                ) : (
                  <div className="abw-db-browser__table-wrap">
                    <table className="abw-db-browser__table" aria-label="Query results">
                      <thead>
                        <tr>
                          {result.columns.map((col) => <th key={col}>{col}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, ri) => (
                          <tr key={ri}>
                            {(row as unknown[]).map((cell, ci) => (
                              <td key={ci}>
                                {cell === null
                                  ? <span style={{ opacity: 0.4, fontStyle: 'italic' }}>NULL</span>
                                  : String(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
