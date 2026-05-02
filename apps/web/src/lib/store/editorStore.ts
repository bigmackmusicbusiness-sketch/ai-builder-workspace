// apps/web/src/lib/store/editorStore.ts — open file tabs + dirty/save state.
// All mutations go through these actions so the tab bar stays in sync.
import { create } from 'zustand';

export interface EditorTab {
  fileId: string;
  path: string;
  language: string;
  content: string;       // current in-editor content
  savedContent: string;  // last-saved content (to detect dirty)
  saving: boolean;
}

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;

  openTab: (tab: Omit<EditorTab, 'saving'>) => void;
  closeTab: (fileId: string) => void;
  setActiveTab: (fileId: string) => void;
  setContent: (fileId: string, content: string) => void;
  markSaved: (fileId: string, savedContent: string) => void;
  setSaving: (fileId: string, saving: boolean) => void;
  /** Drop all tabs. Used on project switch so the editor doesn't show another
   *  project's open files (and the user can't accidentally save them under
   *  the wrong project). */
  clearTabs: () => void;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (tab) => {
    const existing = get().tabs.find((t) => t.fileId === tab.fileId);
    if (existing) {
      set({ activeTabId: tab.fileId });
      return;
    }
    set((s) => ({
      tabs: [...s.tabs, { ...tab, saving: false }],
      activeTabId: tab.fileId,
    }));
  },

  closeTab: (fileId) =>
    set((s) => {
      const remaining = s.tabs.filter((t) => t.fileId !== fileId);
      const activeTabId =
        s.activeTabId === fileId
          ? (remaining[remaining.length - 1]?.fileId ?? null)
          : s.activeTabId;
      return { tabs: remaining, activeTabId };
    }),

  setActiveTab: (fileId) => set({ activeTabId: fileId }),

  setContent: (fileId, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.fileId === fileId ? { ...t, content } : t)),
    })),

  markSaved: (fileId, savedContent) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.fileId === fileId ? { ...t, savedContent, saving: false } : t,
      ),
    })),

  setSaving: (fileId, saving) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.fileId === fileId ? { ...t, saving } : t)),
    })),

  clearTabs: () => set({ tabs: [], activeTabId: null }),
}));

/** True if the tab has unsaved changes. */
export function isTabDirty(tab: EditorTab): boolean {
  return tab.content !== tab.savedContent;
}
