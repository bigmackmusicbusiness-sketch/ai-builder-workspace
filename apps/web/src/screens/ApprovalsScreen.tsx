// apps/web/src/screens/ApprovalsScreen.tsx — full approval queue screen.
// Accessible from /approvals route. Shows all approvals with bundle details,
// inline diff, screenshots, and verification results.
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApprovalBundle {
  scope?:               string;
  scale?:               { filesChanged?: number; linesChanged?: number; recordsAffected?: number };
  diffSummary?:         string;
  screenshots?:         string[];
  verificationResults?: Array<{ adapter: string; ok: boolean; summary: string }>;
  decision?:            { severity: string; description: string };
}

interface ApprovalRow {
  id:          string;
  action:      string;
  status:      'pending' | 'approved' | 'rejected' | 'changes_requested' | 'expired';
  createdAt:   string;
  reviewedAt?: string;
  reviewNote?: string;
  expiresAt?:  string;
  bundle:      ApprovalBundle;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  pending:           { label: 'Pending',           color: 'var(--warning-500)' },
  approved:          { label: 'Approved',          color: 'var(--success-500)' },
  rejected:          { label: 'Rejected',          color: 'var(--error-500)' },
  changes_requested: { label: 'Changes requested', color: 'var(--color-accent)' },
  expired:           { label: 'Expired',           color: 'var(--text-tertiary)' },
};

const SEVERITY_COLOR: Record<string, string> = {
  info:     'var(--color-accent)',
  warning:  'var(--warning-500)',
  critical: 'var(--error-500)',
};

const ACTION_LABEL: Record<string, string> = {
  'deploy.production':            'Deploy → Production',
  'deploy.staging':               'Deploy → Staging',
  'migration.apply.staging':      'Migration apply → Staging',
  'migration.apply.production':   'Migration apply → Production',
  'migration.rollback.staging':   'Migration rollback → Staging',
  'migration.rollback.production':'Migration rollback → Production',
  'secret.create':                'Create secret',
  'secret.rotate':                'Rotate secret',
  'secret.delete':                'Delete secret',
  'integration.connect':          'Connect integration',
  'integration.reconnect':        'Reconnect integration',
  'integration.disconnect':       'Disconnect integration',
  'automation.run.live':          'Run automation (live accounts)',
  'automation.bulk':              'Bulk automation run',
  'delete.destructive':           'Destructive delete',
  'rewrite.broad':                'Broad codebase rewrite',
  'auth.model.change':            'Auth / permission model change',
  'publish.live':                 'Publish to live URL',
  'schema.apply.production':      'Schema apply → Production',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const { label, color } = STATUS_BADGE[status] ?? { label: status, color: 'var(--text-secondary)' };
  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          4,
      padding:      '2px 8px',
      borderRadius: 100,
      background:   `color-mix(in srgb, ${color} 12%, transparent)`,
      color,
      fontSize:     '0.6875rem',
      fontWeight:   600,
    }}>
      {label}
    </span>
  );
}

function BundleDetail({ bundle }: { bundle: ApprovalBundle }) {
  return (
    <div className="abw-approval-bundle">
      {/* Description from decision */}
      {bundle.decision && (
        <div className="abw-approval-bundle__desc" style={{ borderLeftColor: SEVERITY_COLOR[bundle.decision.severity] ?? 'var(--border-base)' }}>
          <span style={{ fontWeight: 600, color: SEVERITY_COLOR[bundle.decision.severity] }}>
            {bundle.decision.severity.toUpperCase()}
          </span>
          <span style={{ marginLeft: 'var(--space-2)' }}>{bundle.decision.description}</span>
        </div>
      )}

      {/* Scope */}
      {bundle.scope && (
        <div className="abw-approval-bundle__row">
          <span className="abw-approval-bundle__label">Scope</span>
          <span>{bundle.scope}</span>
        </div>
      )}

      {/* Scale */}
      {bundle.scale && (
        <div className="abw-approval-bundle__row">
          <span className="abw-approval-bundle__label">Scale</span>
          <span>
            {[
              bundle.scale.filesChanged != null && `${bundle.scale.filesChanged} files`,
              bundle.scale.linesChanged  != null && `${bundle.scale.linesChanged} lines`,
              bundle.scale.recordsAffected != null && `${bundle.scale.recordsAffected} records`,
            ].filter(Boolean).join(', ') || '—'}
          </span>
        </div>
      )}

      {/* Verification results */}
      {(bundle.verificationResults ?? []).length > 0 && (
        <div className="abw-approval-bundle__section">
          <p className="abw-approval-bundle__section-title">Verification</p>
          {(bundle.verificationResults ?? []).map((v, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: '0.75rem', padding: '2px 0' }}>
              <span style={{ color: v.ok ? 'var(--success-500)' : 'var(--error-500)', fontWeight: 700 }}>
                {v.ok ? '✓' : '✗'}
              </span>
              <span style={{ fontWeight: 600 }}>{v.adapter}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{v.summary}</span>
            </div>
          ))}
        </div>
      )}

      {/* Diff summary */}
      {bundle.diffSummary && (
        <div className="abw-approval-bundle__section">
          <p className="abw-approval-bundle__section-title">Diff summary</p>
          <pre style={{ fontSize: '0.6875rem', background: 'var(--bg-base)', padding: 'var(--space-2)', borderRadius: 4, overflow: 'auto', maxHeight: 200 }}>
            {bundle.diffSummary}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Review dialog ─────────────────────────────────────────────────────────────

function ReviewPanel({
  approval,
  onAction,
  reviewing,
}: {
  approval:  ApprovalRow;
  onAction:  (id: string, action: 'approve' | 'reject' | 'changes', note: string) => Promise<void>;
  reviewing: string | null;
}) {
  const [note, setNote] = useState('');

  if (approval.status !== 'pending') {
    return (
      <div style={{ padding: 'var(--space-3)', background: 'var(--bg-elevated)', borderRadius: 4 }}>
        <StatusBadge status={approval.status} />
        {approval.reviewNote && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
            Note: {approval.reviewNote}
          </p>
        )}
        {approval.reviewedAt && (
          <p style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
            {new Date(approval.reviewedAt).toLocaleString()}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="abw-approval-review">
      <label className="abw-field-label" htmlFor="review-note">Review note (optional)</label>
      <textarea
        id="review-note"
        className="abw-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Reason for decision…"
        style={{ resize: 'vertical', width: '100%', fontFamily: 'var(--font-sans)', fontSize: '0.8125rem' }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button
          className="abw-btn abw-btn--primary abw-btn--sm"
          onClick={() => void onAction(approval.id, 'approve', note)}
          disabled={!!reviewing}
        >
          ✓ Approve
        </button>
        <button
          className="abw-btn abw-btn--ghost abw-btn--sm"
          onClick={() => void onAction(approval.id, 'changes', note)}
          disabled={!!reviewing}
        >
          ⟳ Request changes
        </button>
        <button
          className="abw-btn abw-btn--ghost abw-btn--sm"
          style={{ color: 'var(--error-500)' }}
          onClick={() => void onAction(approval.id, 'reject', note)}
          disabled={!!reviewing}
        >
          ✕ Reject
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ApprovalsScreen() {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState<FilterStatus>('pending');
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ approvals?: ApprovalRow[] }>('/api/approvals');
      setApprovals(data.approvals ?? []);
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleAction = useCallback(async (
    id: string,
    action: 'approve' | 'reject' | 'changes',
    note: string,
  ) => {
    setReviewing(id);
    try {
      await apiFetch(`/api/approvals/${id}/${action === 'changes' ? 'changes' : action}`, {
        method: 'POST',
        body:   JSON.stringify({ note }),
      });
      await load();
    } finally { setReviewing(null); }
  }, [load]);

  const filtered = filter === 'all'
    ? approvals
    : approvals.filter((a) => a.status === filter);

  const pendingCount = approvals.filter((a) => a.status === 'pending').length;

  return (
    <div className="abw-screen">
      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">
            Approvals
            {pendingCount > 0 && (
              <span style={{
                marginLeft: 'var(--space-2)',
                background: 'var(--warning-500)',
                color: '#fff',
                borderRadius: 100,
                padding: '1px 8px',
                fontSize: '0.75rem',
                fontWeight: 700,
              }}>
                {pendingCount} pending
              </span>
            )}
          </h1>
          <p className="abw-screen__sub">
            Every sensitive action — production deploys, migrations, secrets, integrations — requires approval before execution.
            Approval decisions are audited and cannot be bypassed via the API.
          </p>
        </div>
        <button
          className="abw-btn abw-btn--ghost abw-btn--sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh"
        >
          ↺ Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Approval filter">
        {(['pending', 'approved', 'rejected', 'all'] as FilterStatus[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            className={`abw-screen__tab${filter === f ? ' abw-screen__tab--active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 72, borderRadius: 4, background: 'var(--bg-elevated)', animation: 'pulse 1.4s ease infinite' }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>✅</span>
          <span className="abw-empty-state__label">
            {filter === 'pending' ? 'No pending approvals' : `No ${filter} approvals`}
          </span>
          <span className="abw-empty-state__sub">
            {filter === 'pending'
              ? 'All clear — no actions are waiting for your review.'
              : 'No approvals match this filter.'}
          </span>
        </div>
      )}

      {/* Approval list */}
      {!loading && filtered.map((a) => (
        <div
          key={a.id}
          className={`abw-approval-card${a.status === 'pending' ? ' abw-approval-card--pending' : ''}`}
        >
          {/* Card header */}
          <button
            className="abw-approval-card__header"
            onClick={() => setExpanded(expanded === a.id ? null : a.id)}
            aria-expanded={expanded === a.id}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1, minWidth: 0 }}>
              {/* Severity dot */}
              {a.bundle.decision && (
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: SEVERITY_COLOR[a.bundle.decision.severity] ?? 'var(--border-base)',
                }} aria-hidden />
              )}
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: '0.875rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ACTION_LABEL[a.action] ?? a.action}
                </p>
                <p style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', margin: 0 }}>
                  Requested {new Date(a.createdAt).toLocaleString()}
                  {a.expiresAt && ` · Expires ${new Date(a.expiresAt).toLocaleString()}`}
                </p>
              </div>
            </div>
            <StatusBadge status={a.status} />
            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', marginLeft: 'var(--space-2)' }}>
              {expanded === a.id ? '▲' : '▼'}
            </span>
          </button>

          {/* Expanded bundle + review */}
          {expanded === a.id && (
            <div className="abw-approval-card__body">
              <BundleDetail bundle={a.bundle} />
              <div style={{ marginTop: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-3)' }}>
                <ReviewPanel approval={a} onAction={handleAction} reviewing={reviewing} />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
