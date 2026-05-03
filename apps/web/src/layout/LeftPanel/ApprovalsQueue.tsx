// apps/web/src/layout/LeftPanel/ApprovalsQueue.tsx — inline approvals dock.
//
// Renders inside the chat thread (above the composer) only when there is
// something to show — pending approvals or very recent decisions. Returns
// null otherwise so the chat panel doesn't carry an empty section all the
// time. Full-screen Approvals route at /approvals still has the complete
// history; this component is the in-chat fast path.
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../lib/api';

interface ApprovalRow {
  id:          string;
  action:      string;
  status:      string;
  createdAt:   string;
  bundle:      Record<string, unknown>;
}

const STATUS_COLOR: Record<string, string> = {
  pending:           'var(--warning-500)',
  approved:          'var(--success-500)',
  rejected:          'var(--error-500)',
  changes_requested: 'var(--color-accent)',
  expired:           'var(--text-tertiary)',
};

const ACTION_LABEL: Record<string, string> = {
  'deploy.production':           'Deploy → Production',
  'deploy.staging':              'Deploy → Staging',
  'migration.apply.staging':     'Migration → Staging',
  'migration.apply.production':  'Migration → Production',
  'migration.rollback.staging':  'Rollback → Staging',
  'migration.rollback.production':'Rollback → Production',
  'secret.create':               'Create Secret',
  'secret.rotate':               'Rotate Secret',
  'secret.delete':               'Delete Secret',
  'integration.connect':         'Connect Integration',
  'integration.reconnect':       'Reconnect Integration',
  'integration.disconnect':      'Disconnect Integration',
  'automation.run.live':         'Run Automation (Live)',
  'automation.bulk':             'Bulk Automation',
  'delete.destructive':          'Destructive Delete',
  'rewrite.broad':               'Broad Rewrite',
  'auth.model.change':           'Auth Model Change',
  'publish.live':                'Publish to Live',
  'schema.apply.production':     'Schema → Production',
};

export function ApprovalsQueue() {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [loading, setLoading]     = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [openId,    setOpenId]    = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ approvals?: ApprovalRow[] }>('/api/approvals');
      setApprovals(data.approvals ?? []);
    } catch { /* network offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const review = async (id: string, action: 'approve' | 'reject' | 'changes', note?: string) => {
    setReviewing(id);
    try {
      await apiFetch(`/api/approvals/${id}/${action === 'changes' ? 'changes' : action}`, {
        method: 'POST',
        body:   JSON.stringify({ note }),
      });
      await load();
    } finally { setReviewing(null); }
  };

  const pending = approvals.filter((a) => a.status === 'pending');
  // Only show recent decisions transiently if they decided in the last 30s,
  // so the chat panel doesn't carry stale history under the composer.
  const recentCutoff = Date.now() - 30_000;
  const recent  = approvals
    .filter((a) => a.status !== 'pending' && new Date(a.createdAt).getTime() > recentCutoff)
    .slice(0, 2);

  // Silent when nothing pending and no fresh decisions — caller renders nothing.
  if (pending.length === 0 && recent.length === 0) return null;

  return (
    <div className="abw-approvals-queue abw-approvals-queue--inline">
      {pending.length > 0 && (
        <div className="abw-approvals-queue__inline-header">
          <span className="abw-approvals-queue__badge abw-approvals-queue__badge--pulse">
            {pending.length}
          </span>
          <span style={{ fontWeight: 500 }}>
            {pending.length === 1 ? 'Approval needed' : `${pending.length} approvals needed`}
          </span>
          <button
            className="abw-btn abw-btn--ghost abw-btn--xs"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh approvals"
            title="Refresh"
            style={{ marginLeft: 'auto' }}
          >
            ↺
          </button>
        </div>
      )}

      {pending.map((a) => (
        <div key={a.id} className="abw-approvals-queue__item abw-approvals-queue__item--pending">
          <div className="abw-approvals-queue__item-action">
            {ACTION_LABEL[a.action] ?? a.action}
          </div>
          <div className="abw-approvals-queue__item-meta">
            {new Date(a.createdAt).toLocaleString()}
          </div>
          <div className="abw-approvals-queue__item-actions">
            <button
              className="abw-btn abw-btn--primary abw-btn--xs"
              onClick={() => void review(a.id, 'approve')}
              disabled={reviewing === a.id}
              aria-label="Approve"
            >
              ✓ Approve
            </button>
            <button
              className="abw-btn abw-btn--ghost abw-btn--xs"
              style={{ color: 'var(--error-500)' }}
              onClick={() => void review(a.id, 'reject')}
              disabled={reviewing === a.id}
              aria-label="Reject"
            >
              ✕ Reject
            </button>
            <button
              className="abw-btn abw-btn--ghost abw-btn--xs"
              onClick={() => setOpenId(openId === a.id ? null : a.id)}
              aria-expanded={openId === a.id}
              aria-controls={`approval-details-${a.id}`}
              style={{ marginLeft: 'auto' }}
            >
              {openId === a.id ? 'Hide' : 'Details'}
            </button>
          </div>
          {openId === a.id && (
            <div
              id={`approval-details-${a.id}`}
              style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-2)',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-base)',
                borderRadius: 'var(--radius-field)',
                fontSize: '0.6875rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                maxHeight: 200,
                overflow: 'auto',
                color: 'var(--text-secondary)',
              }}
            >
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {JSON.stringify(a.bundle, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ))}

      {/* Recent decisions — only the last 30s so the dock doesn't accumulate stale rows. */}
      {recent.length > 0 && (
        <>
          {recent.map((a) => (
            <div key={a.id} className="abw-approvals-queue__item">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: STATUS_COLOR[a.status] ?? 'var(--text-tertiary)',
                  flexShrink: 0,
                }} aria-hidden />
                <span className="abw-approvals-queue__item-action" style={{ fontSize: '0.6875rem' }}>
                  {ACTION_LABEL[a.action] ?? a.action}
                </span>
              </div>
              <div className="abw-approvals-queue__item-meta">
                {a.status} · {new Date(a.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
