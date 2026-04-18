// apps/web/src/screens/VersionsScreen.tsx — project snapshot list + restore.
// Each snapshot captures the full file→blob map at a point in time.
// Restore creates a NEW snapshot pointing at old blobs — never destructive.
import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type SnapshotTrigger = 'manual' | 'agent-step' | 'agent-run-start' | 'save';

interface Snapshot {
  id:          string;
  label:       string | null;
  trigger:     SnapshotTrigger;
  fileCount:   number;
  createdAt:   string;
  createdBy:   string;
  runId?:      string;
  notes?:      string;
  restored?:   boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

function triggerLabel(t: SnapshotTrigger): string {
  switch (t) {
    case 'manual':          return 'Manual snapshot';
    case 'agent-step':      return 'Agent step';
    case 'agent-run-start': return 'Before run (auto)';
    case 'save':            return 'File save';
  }
}

function triggerIcon(t: SnapshotTrigger): string {
  switch (t) {
    case 'manual':          return '📸';
    case 'agent-step':      return '🤖';
    case 'agent-run-start': return '🔒';
    case 'save':            return '💾';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VersionsScreen() {
  const [snapshots, setSnapshots]   = useState<Snapshot[]>([]);
  const [restoring, setRestoring]   = useState<string | null>(null);
  const [restored, setRestored]     = useState<string | null>(null);
  const [showNote, setShowNote]     = useState(false);
  const [noteText, setNoteText]     = useState('');

  async function handleRestore(snap: Snapshot) {
    if (!confirm(`Restore to "${snap.label ?? relativeTime(snap.createdAt)}"? This creates a new snapshot — your current work is preserved.`)) return;
    setRestoring(snap.id);
    // TODO: POST /api/versions/restore { versionId: snap.id }
    await new Promise((r) => setTimeout(r, 1000));
    setRestoring(null);
    setRestored(snap.id);
    // Mark as restored in list
    setSnapshots((prev) => prev.map((s) => s.id === snap.id ? { ...s, restored: true } : s));
  }

  function handleSnapshotNow() {
    if (!noteText.trim()) {
      setShowNote(true);
      return;
    }
    const snap: Snapshot = {
      id:        crypto.randomUUID(),
      label:     noteText.trim() || null,
      trigger:   'manual',
      fileCount: 0,
      createdAt: new Date().toISOString(),
      createdBy: 'You',
      notes:     noteText.trim() || undefined,
    };
    setSnapshots((prev) => [snap, ...prev]);
    setNoteText('');
    setShowNote(false);
  }

  return (
    <div className="abw-screen">
      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Versions</h1>
          <p className="abw-screen__sub">
            {snapshots.length === 0
              ? 'Snapshots are created automatically before every agent run and on every manual save.'
              : `${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''}. Restoring is non-destructive — creates a new snapshot.`}
          </p>
        </div>
        <button
          className="abw-btn abw-btn--secondary"
          onClick={() => setShowNote(true)}
          aria-label="Take snapshot now"
        >
          📸 Snapshot now
        </button>
      </div>

      {/* Restored banner */}
      {restored && (
        <div className="abw-banner abw-banner--success" role="status" aria-live="polite">
          <strong>Restored.</strong> A new snapshot has been created pointing at the selected version. Your previous state is still in the list above.
        </div>
      )}

      {/* Empty state */}
      {snapshots.length === 0 ? (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>🕐</span>
          <p className="abw-empty-state__label">No snapshots yet</p>
          <p className="abw-empty-state__sub">
            Snapshots are created automatically before every agent run, and on every file save. You can also create one manually at any time.
          </p>
          <button className="abw-btn abw-btn--primary" onClick={() => setShowNote(true)}>
            Take first snapshot
          </button>
        </div>
      ) : (
        <div className="abw-versions__list">
          {snapshots.map((snap, idx) => (
            <div
              key={snap.id}
              className={`abw-version-row${idx === 0 && !snap.restored ? ' abw-version-row--current' : ''}`}
              aria-label={snap.label ?? `Snapshot ${idx + 1}`}
            >
              <span className="abw-version-row__icon" aria-hidden>{triggerIcon(snap.trigger)}</span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                    {snap.label ?? relativeTime(snap.createdAt)}
                  </span>
                  {idx === 0 && !snap.restored && (
                    <span className="abw-badge" style={{ fontSize: '0.625rem' }}>current</span>
                  )}
                  {snap.restored && (
                    <span className="abw-badge abw-badge--info" style={{ fontSize: '0.625rem' }}>restored from</span>
                  )}
                </div>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {triggerLabel(snap.trigger)} · {snap.fileCount} file{snap.fileCount !== 1 ? 's' : ''} · by {snap.createdBy} · {relativeTime(snap.createdAt)}
                </p>
                {snap.notes && (
                  <p style={{ margin: 'var(--space-1) 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    {snap.notes}
                  </p>
                )}
              </div>

              <button
                className="abw-btn abw-btn--ghost abw-btn--sm"
                disabled={restoring === snap.id || idx === 0}
                onClick={() => void handleRestore(snap)}
                aria-label={`Restore to ${snap.label ?? 'this snapshot'}`}
                title={idx === 0 ? 'This is the current version' : 'Restore (non-destructive)'}
              >
                {restoring === snap.id ? 'Restoring…' : '↩ Restore'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Snapshot-now dialog */}
      {showNote && (
        <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label="Take snapshot">
          <div className="abw-dialog">
            <div className="abw-dialog__header">
              <h2 className="abw-dialog__title">📸 Take snapshot</h2>
              <button className="abw-dialog__close" onClick={() => { setShowNote(false); setNoteText(''); }} aria-label="Close">✕</button>
            </div>
            <div className="abw-dialog__body">
              <label className="abw-field-label" htmlFor="snap-label">Label <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional)</span></label>
              <input
                id="snap-label"
                className="abw-input"
                type="text"
                placeholder="e.g. Before pricing redesign"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSnapshotNow()}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
              <p style={{ marginTop: 'var(--space-2)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Captures the current state of all project files. Restore is always non-destructive.
              </p>
            </div>
            <div className="abw-dialog__footer">
              <button className="abw-btn abw-btn--ghost" onClick={() => { setShowNote(false); setNoteText(''); }}>Cancel</button>
              <button className="abw-btn abw-btn--primary" onClick={handleSnapshotNow}>Take snapshot</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
