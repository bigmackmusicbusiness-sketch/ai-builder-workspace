// apps/web/src/features/editor/EditorTabs.tsx — file tab bar with dirty indicator.
// Dirty tabs show "●"; saving tabs show "…"; saved tabs are clean. Close guard on dirty.
import { useEditorStore, isTabDirty, type EditorTab } from '../../lib/store/editorStore';

export function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditorStore();

  if (tabs.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', overflowX: 'auto',
        background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-base)',
        flexShrink: 0, minHeight: 36,
      }}
      role="tablist"
      aria-label="Open files"
    >
      {tabs.map((tab) => (
        <FileTab
          key={tab.fileId}
          tab={tab}
          isActive={tab.fileId === activeTabId}
          onActivate={() => setActiveTab(tab.fileId)}
          onClose={() => {
            if (isTabDirty(tab)) {
              const ok = window.confirm(
                `"${tab.path}" has unsaved changes. Close anyway?`,
              );
              if (!ok) return;
            }
            closeTab(tab.fileId);
          }}
        />
      ))}
    </div>
  );
}

function FileTab({
  tab,
  isActive,
  onActivate,
  onClose,
}: {
  tab: EditorTab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const dirty = isTabDirty(tab);
  const filename = tab.path.split('/').pop() ?? tab.path;

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '0 var(--space-3)', height: 36, flexShrink: 0,
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        borderRight: '1px solid var(--border-base)',
        borderBottom: isActive ? '2px solid var(--accent-500)' : '2px solid transparent',
        background: isActive ? 'var(--bg-base)' : 'transparent',
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: '0.8125rem',
      }}
      onClick={onActivate}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
      title={tab.path}
    >
      {/* Dirty / saving indicator */}
      <span
        style={{
          width: 8, fontSize: '0.625rem',
          color: dirty ? 'var(--accent-500)' : 'transparent',
        }}
        aria-label={dirty ? 'Unsaved changes' : tab.saving ? 'Saving' : undefined}
      >
        {tab.saving ? '…' : dirty ? '●' : ''}
      </span>
      <span>{filename}</span>
      {/* Close button */}
      <button
        style={{
          border: 'none', background: 'none', cursor: 'pointer',
          padding: '1px 2px', borderRadius: 3, lineHeight: 1,
          color: 'var(--text-secondary)', fontSize: '0.75rem',
          display: 'flex', alignItems: 'center',
        }}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label={`Close ${filename}`}
        title={`Close ${filename}${dirty ? ' (unsaved changes)' : ''}`}
      >
        ×
      </button>
    </div>
  );
}
