// apps/web/src/screens/JobsQueuesScreen.tsx — job/queue management UI.
// Lists jobs, shows last run, queue depth stub, and trigger/enable/delete controls.
// Upstash QStash integration is a TODO on the API side; UI shows queue as pending.
import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Job {
  id:        string;
  name:      string;
  handler:   string;
  cron:      string | null;
  enabled:   boolean;
  lastRunAt: string | null;
  lastError: string | null;
  config: {
    maxRetries?: number;
    timeoutMs?:  number;
    queue?:      string;
  };
}

// ── Stub data (replaced by TanStack Query against /api/jobs in Step 9) ────────

const STUB_JOBS: Job[] = [
  {
    id: '1', name: 'Send weekly report', handler: 'src/jobs/weeklyReport.ts',
    cron: '0 9 * * MON', enabled: true,
    lastRunAt: '2026-04-14T09:00:00Z', lastError: null,
    config: { maxRetries: 3, timeoutMs: 60_000 },
  },
  {
    id: '2', name: 'Purge old preview sessions', handler: 'src/jobs/purgePreviews.ts',
    cron: '0 0 * * *', enabled: true,
    lastRunAt: '2026-04-17T00:00:00Z', lastError: null,
    config: { maxRetries: 1, timeoutMs: 30_000 },
  },
  {
    id: '3', name: 'Sync CRM contacts', handler: 'src/jobs/crmSync.ts',
    cron: null, enabled: false,
    lastRunAt: null, lastError: 'Connection refused',
    config: { maxRetries: 5, timeoutMs: 120_000, queue: 'integrations' },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)  return 'Just now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function StatusDot({ enabled, error }: { enabled: boolean; error: string | null }) {
  const color = !enabled ? 'var(--text-disabled)' : error ? 'var(--error-500)' : 'var(--success-500)';
  const label = !enabled ? 'Disabled' : error ? 'Error' : 'Active';
  return (
    <span
      style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }}
      title={label}
      aria-label={label}
    />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function JobsQueuesScreen() {
  const [jobs, setJobs] = useState<Job[]>(STUB_JOBS);
  const [showCreate, setShowCreate] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);

  function handleToggle(id: string) {
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, enabled: !j.enabled } : j));
  }

  async function handleTrigger(id: string) {
    setTriggering(id);
    // TODO: POST /api/jobs/:id/trigger
    await new Promise((r) => setTimeout(r, 800));
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, lastRunAt: new Date().toISOString() } : j));
    setTriggering(null);
  }

  return (
    <div className="abw-screen">
      {/* Page header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Jobs &amp; Queues</h1>
          <p className="abw-screen__sub">Scheduled and on-demand jobs. Queue integration via Upstash QStash.</p>
        </div>
        <button
          className="abw-btn abw-btn--primary"
          onClick={() => setShowCreate(true)}
          aria-label="Create job"
        >
          + New job
        </button>
      </div>

      {/* Queue depth callout */}
      <div className="abw-callout" role="note">
        <span className="abw-callout__icon" aria-hidden>⚡</span>
        <span>Queue depth: <strong>0</strong> — Upstash QStash will be wired in the next step.</span>
      </div>

      {/* Jobs list */}
      {jobs.length === 0 ? (
        <EmptyState onAdd={() => setShowCreate(true)} />
      ) : (
        <div className="abw-table-wrap">
          <table className="abw-table" aria-label="Jobs">
            <thead>
              <tr>
                <th>Status</th>
                <th>Name</th>
                <th>Handler</th>
                <th>Schedule</th>
                <th>Last run</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  triggering={triggering === job.id}
                  onToggle={() => handleToggle(job.id)}
                  onTrigger={() => handleTrigger(job.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateJobDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface JobRowProps {
  job:        Job;
  triggering: boolean;
  onToggle:   () => void;
  onTrigger:  () => void;
}

function JobRow({ job, triggering, onToggle, onTrigger }: JobRowProps) {
  return (
    <tr>
      <td>
        <StatusDot enabled={job.enabled} error={job.lastError} />
      </td>
      <td>
        <div>
          <span className="abw-table__name">{job.name}</span>
          {job.lastError && (
            <div style={{ fontSize: '0.75rem', color: 'var(--error-500)', marginTop: 2 }}>
              Error: {job.lastError}
            </div>
          )}
        </div>
      </td>
      <td>
        <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{job.handler}</code>
      </td>
      <td style={{ color: 'var(--text-secondary)' }}>
        {job.cron ?? <span style={{ fontStyle: 'italic' }}>On-demand</span>}
      </td>
      <td style={{ color: 'var(--text-secondary)' }}>
        {relativeTime(job.lastRunAt)}
      </td>
      <td>
        <div className="abw-table__actions">
          <button
            className="abw-btn abw-btn--ghost abw-btn--sm"
            onClick={onTrigger}
            disabled={triggering}
            aria-label={`Trigger ${job.name}`}
          >
            {triggering ? '…' : '▶ Run'}
          </button>
          <button
            className="abw-btn abw-btn--ghost abw-btn--sm"
            onClick={onToggle}
            aria-label={job.enabled ? `Disable ${job.name}` : `Enable ${job.name}`}
          >
            {job.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </td>
    </tr>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="abw-empty-state">
      <span className="abw-empty-state__icon" aria-hidden>⏱</span>
      <p className="abw-empty-state__label">No jobs yet</p>
      <p className="abw-empty-state__sub">Create a job with a handler path and an optional cron schedule. Retry and timeout are configurable per job.</p>
      <button className="abw-btn abw-btn--primary" onClick={onAdd}>Create first job</button>
    </div>
  );
}

function CreateJobDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label="Create job">
      <div className="abw-dialog">
        <div className="abw-dialog__header">
          <h2 className="abw-dialog__title">New Job</h2>
          <button className="abw-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="abw-dialog__body">
          <label className="abw-field-label" htmlFor="job-name">Name</label>
          <input id="job-name" className="abw-input" type="text" placeholder="e.g. Send weekly report" />

          <label className="abw-field-label" htmlFor="job-handler" style={{ marginTop: 'var(--space-3)' }}>Handler path</label>
          <input id="job-handler" className="abw-input" type="text" placeholder="src/jobs/myJob.ts" spellCheck={false} />

          <label className="abw-field-label" htmlFor="job-cron" style={{ marginTop: 'var(--space-3)' }}>
            Cron schedule <span style={{ color: 'var(--text-secondary)' }}>(optional)</span>
          </label>
          <input id="job-cron" className="abw-input" type="text" placeholder="0 9 * * MON" spellCheck={false} />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
            Leave blank for on-demand only.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            <div>
              <label className="abw-field-label" htmlFor="job-retries">Max retries</label>
              <input id="job-retries" className="abw-input" type="number" min={0} max={10} defaultValue={3} />
            </div>
            <div>
              <label className="abw-field-label" htmlFor="job-timeout">Timeout (ms)</label>
              <input id="job-timeout" className="abw-input" type="number" min={1000} defaultValue={30000} />
            </div>
          </div>
        </div>

        <div className="abw-dialog__footer">
          <button className="abw-btn abw-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="abw-btn abw-btn--primary">Create job</button>
        </div>
      </div>
    </div>
  );
}
