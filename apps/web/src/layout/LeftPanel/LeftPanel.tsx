// apps/web/src/layout/LeftPanel/LeftPanel.tsx — collapsible left AI/chat/task panel.
// Sections: Chat (always expanded, fills space), Run History, Plan Summary,
// Approvals docked under chat. Status pill + chat composer at the bottom.
//
// Fixed-header tax was ~96px (header + AgentStatus + ModelSelector). Now ~28px:
// just a thin "+ New chat" button row at the top. StatusPill (32px) sits
// between accordions and chat input as a single combined control.
import type { ReactNode } from 'react';
import { ChatThread } from './ChatThread';
import { ApprovalsQueue } from './ApprovalsQueue';
import { useChatStore } from '../../lib/store/chatStore';
import { useProjectStore } from '../../lib/store/projectStore';

export function LeftPanel() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const clearProject     = useChatStore((s) => s.clearProject);

  return (
    <aside className="abw-shell__left" aria-label="AI panel">
      <div className="abw-left">
        {/* Thin header — single button, ~24px tall */}
        <div
          className="abw-left__header"
          style={{ minHeight: 24, padding: '4px var(--space-3)' }}
        >
          <button
            type="button"
            onClick={() => clearProject(currentProjectId)}
            style={{
              border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)', fontSize: '0.6875rem', fontWeight: 600,
              padding: '2px var(--space-1)', borderRadius: 'var(--radius-field)',
              marginLeft: 'auto',
            }}
            aria-label="Start a new chat"
            title="Clear chat for this project"
          >
            + New chat
          </button>
        </div>

        {/* Scrollable sections */}
        <div className="abw-left__sections">
          {/* Chat — always expanded, fills available space */}
          <div className="abw-left__section" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <ChatThread />
          </div>

          {/* Approvals dock — directly below chat */}
          <Accordion icon="✓" label="Approvals" count={0} defaultOpen>
            <ApprovalsQueue />
          </Accordion>

          <Accordion icon="⏱" label="Run history" count={0}>
            <p className="abw-left__accordion-empty">Previous runs appear here.</p>
          </Accordion>

          <Accordion icon="📋" label="Plan summary" count={0}>
            <p className="abw-left__accordion-empty">Active plan appears here.</p>
          </Accordion>
        </div>
      </div>
    </aside>
  );
}

interface AccordionProps {
  icon:        string;
  label:       string;
  count:       number;
  defaultOpen?: boolean;
  children:    ReactNode;
}

function Accordion({ icon, label, count, defaultOpen = false, children }: AccordionProps) {
  return (
    <details className="abw-left__accordion" open={defaultOpen || count > 0}>
      <summary>
        <svg className="abw-left__accordion-caret" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M3 2 L7 5 L3 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="abw-left__accordion-icon" aria-hidden>{icon}</span>
        <span className="abw-left__accordion-label">{label}</span>
        <span className={`abw-left__accordion-count${count === 0 ? ' abw-left__accordion-count--zero' : ''}`}>
          {count}
        </span>
      </summary>
      <div className="abw-left__accordion-body">
        {children}
      </div>
    </details>
  );
}
