// apps/web/src/layout/LeftPanel/LeftPanel.tsx — left AI/chat panel.
//
// The chat is the entire panel — no docked accordions for Approvals,
// Run history, or Plan summary anymore (they made the panel feel
// claustrophobic when there was nothing pending). Approvals now surface
// inline inside the chat thread when something needs review; Run history
// + Plan summary live behind the Settings → operational submenu in the
// top bar (their full-screen routes are still wired).
import { useEffect, useRef } from 'react';
import { ChatThread } from './ChatThread';
import { useChatStore } from '../../lib/store/chatStore';
import { useEditorStore } from '../../lib/store/editorStore';
import { useProjectStore } from '../../lib/store/projectStore';

export function LeftPanel() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const clearProject     = useChatStore((s) => s.clearProject);
  const clearEditorTabs  = useEditorStore((s) => s.clearTabs);

  // F.2: When the user switches projects, drop any open editor tabs from the
  // previous project. Without this, switching would still show the old
  // project's main.tsx (and let the user accidentally save it under the new
  // project). Skip-first-run via ref so reopening the same project on page
  // load doesn't blow away tabs the user might have legitimately persisted.
  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevProjectIdRef.current !== null && prevProjectIdRef.current !== currentProjectId) {
      clearEditorTabs();
    }
    prevProjectIdRef.current = currentProjectId;
  }, [currentProjectId, clearEditorTabs]);

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

        {/* Chat fills the remaining space — no other docked sections. */}
        <div className="abw-left__sections" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ChatThread />
        </div>
      </div>
    </aside>
  );
}
