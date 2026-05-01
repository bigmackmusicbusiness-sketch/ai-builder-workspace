// apps/web/src/layout/MainWorkspace/modes/CodeMode.tsx — Monaco editor + tabs.
// Ctrl+S saves to server; 30s autosave when dirty; dirty indicator in tab bar.
import { useCallback, useEffect } from 'react';
import { useEditorStore, isTabDirty } from '../../../lib/store/editorStore';
import { EditorTabs } from '../../../features/editor/EditorTabs';
import { MonacoEditor } from '../../../features/editor/MonacoEditor';
import { ProposedChangesTray, type FileDiff } from '../../../features/editor/DiffViewer';
import { apiFetch } from '../../../lib/api';

// Stub diffs — real diffs from agent steps arrive in Step 9.
const STUB_DIFFS: FileDiff[] = [];

export function CodeMode() {
  const { tabs, activeTabId, setContent, markSaved, setSaving } = useEditorStore();

  const activeTab = tabs.find((t) => t.fileId === activeTabId) ?? null;

  const handleChange = useCallback(
    (value: string) => {
      if (activeTab) setContent(activeTab.fileId, value);
    },
    [activeTab, setContent],
  );

  const handleSave = useCallback(async () => {
    if (!activeTab || !isTabDirty(activeTab)) return;
    setSaving(activeTab.fileId, true);
    try {
      await apiFetch(`/api/files/${activeTab.fileId}`, {
        method: 'POST',
        body: JSON.stringify({
          content: activeTab.content,
          lang:    activeTab.language ?? 'plaintext',
        }),
      });
      markSaved(activeTab.fileId, activeTab.content);
    } catch (err) {
      // Save failed — leave dirty indicator so user can retry with Ctrl+S
      console.error('[CodeMode] Save failed:', err);
    } finally {
      setSaving(activeTab.fileId, false);
    }
  }, [activeTab, setSaving, markSaved]);

  // 30-second autosave when content is dirty
  useEffect(() => {
    if (!activeTab || !isTabDirty(activeTab)) return;
    const timer = setTimeout(() => { void handleSave(); }, 30_000);
    return () => clearTimeout(timer);
  }, [activeTab?.content, activeTab?.fileId, handleSave]); // eslint-disable-line react-hooks/exhaustive-deps

  // Empty state when no tabs open
  if (tabs.length === 0) {
    return (
      <div className="abw-mode-placeholder" style={{ height: '100%' }}>
        <span className="abw-mode-placeholder__icon" aria-hidden>{'</>'}</span>
        <span className="abw-mode-placeholder__label">No file open</span>
        <span className="abw-mode-placeholder__sub">
          Open a file from the Files tab (or press <kbd style={{ fontFamily: 'var(--font-mono)', padding: '1px 4px', border: '1px solid var(--border-base)', borderRadius: 3 }}>Ctrl+P</kbd>).
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* Tab bar */}
      <EditorTabs />

      {/* Editor area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab ? (
          <MonacoEditor
            key={activeTab.fileId} // remount when switching files to reset scroll position
            fileId={activeTab.fileId}
            path={activeTab.path}
            content={activeTab.content}
            language={activeTab.language}
            onChange={handleChange}
            onSave={handleSave}
          />
        ) : (
          <div className="abw-mode-placeholder" style={{ height: '100%' }}>
            <span className="abw-mode-placeholder__sub">Select a tab above</span>
          </div>
        )}
      </div>

      {/* Proposed changes tray (agent diffs) */}
      <ProposedChangesTray
        diffs={STUB_DIFFS}
        onAccept={(fileId, newContent) => {
          markSaved(fileId, newContent);
          setContent(fileId, newContent);
        }}
        onReject={(_fileId) => { /* remove from diffs */ }}
        onAcceptAll={() => { /* accept all */ }}
        onRejectAll={() => { /* reject all */ }}
      />
    </div>
  );
}
