// apps/web/src/lib/store/shellStore.ts — shell layout state (persisted to localStorage).
// Collapsed/expanded left panel, active workspace mode, split layout.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type WorkspaceMode = 'preview' | 'code' | 'files' | 'console' | 'tests' | 'visualqa' | 'split' | 'api-tester' | 'terminal';

export interface SplitLayout {
  left: WorkspaceMode;
  right: WorkspaceMode;
  splitPct: number; // 0–100, percentage for left pane
}

interface ShellState {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggleCollapsed: () => void;

  activeMode: WorkspaceMode;
  setActiveMode: (mode: WorkspaceMode) => void;

  splitLayout: SplitLayout;
  setSplitLayout: (layout: Partial<SplitLayout>) => void;
}

export const useShellStore = create<ShellState>()(
  persist<ShellState>(
    (set) => ({
      collapsed: false,
      setCollapsed: (v: boolean) => set({ collapsed: v }),
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),

      activeMode: 'preview' as WorkspaceMode,
      setActiveMode: (mode: WorkspaceMode) => set({ activeMode: mode }),

      splitLayout: { left: 'preview', right: 'code', splitPct: 50 } as SplitLayout,
      setSplitLayout: (layout: Partial<SplitLayout>) =>
        set((s) => ({ splitLayout: { ...s.splitLayout, ...layout } })),
    }),
    {
      name: 'abw-shell',
      partialize: (s) => ({
        collapsed: s.collapsed,
        activeMode: s.activeMode,
        splitLayout: s.splitLayout,
      } as ShellState),
    },
  ),
);
