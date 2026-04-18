// apps/web/src/layout/LeftPanel/LeftPanel.tsx — collapsible left AI/chat/task panel.
// Sections: Chat, Run History (stub), Plan Summary (stub), Approvals (live),
// Agent Status, Model Selector. State survives collapse (Zustand stores are global).
import { useRunStore } from '../../lib/store/runStore';
import { ChatThread } from './ChatThread';
import { AgentStatus } from './AgentStatus';
import { ModelSelector } from './ModelSelector';
import { ApprovalsQueue } from './ApprovalsQueue';

export function LeftPanel() {
  const { activeRun } = useRunStore();

  return (
    <aside className="abw-shell__left" aria-label="AI panel">
      <div className="abw-left">
        {/* Panel header */}
        <div className="abw-left__header">
          <span className="abw-left__header-title">AI Builder</span>
          <button
            style={{
              border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)', fontSize: '0.75rem',
              padding: '2px var(--space-1)', borderRadius: 'var(--radius-field)',
            }}
            aria-label="New run"
            title="New run"
          >
            + Run
          </button>
        </div>

        {/* Scrollable sections */}
        <div className="abw-left__sections">
          {/* Chat section */}
          <div className="abw-left__section" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <ChatThread />
          </div>

          {/* Run History — stub (wired in Step 9) */}
          <SectionPlaceholder icon="⏱" label="Run History" sub="Previous runs appear here" />

          {/* Plan Summary — stub */}
          <SectionPlaceholder icon="📋" label="Plan Summary" sub="Active plan appears here" />

          {/* Approvals queue — live, calls /api/approvals */}
          <div className="abw-left__section">
            <ApprovalsQueue />
          </div>
        </div>

        {/* Bottom: Agent status + Model selector — always visible */}
        <AgentStatus
          status={activeRun?.status ?? 'idle'}
          currentStep={activeRun?.currentStep}
        />
        <ModelSelector />
      </div>
    </aside>
  );
}

function SectionPlaceholder({ icon, label, sub }: { icon: string; label: string; sub: string }) {
  return (
    <div className="abw-left__section" style={{ marginBottom: 'var(--space-2)' }}>
      <div className="abw-left__section-label">{label}</div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-2) 0', color: 'var(--text-secondary)', fontSize: '0.8125rem',
      }}>
        <span aria-hidden style={{ opacity: 0.4 }}>{icon}</span>
        <span>{sub}</span>
      </div>
    </div>
  );
}
