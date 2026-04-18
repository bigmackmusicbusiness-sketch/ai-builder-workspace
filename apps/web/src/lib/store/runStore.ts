// apps/web/src/lib/store/runStore.ts — per-run model selection + active run state.
// selectedProvider/selectedModel are always visible in the UI and pinned to every run.
// No silent fallback: fallbackEnabled default is false.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AgentRunStatus =
  | 'idle' | 'planning' | 'building' | 'running'
  | 'inspecting' | 'fixing' | 'blocked' | 'error' | 'done';

export interface ActiveRun {
  id: string;
  goal: string;
  status: AgentRunStatus;
  currentStep?: string;
  startedAt: number;
}

interface RunState {
  selectedProvider: string;
  selectedModel: string;
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;

  fallbackEnabled: boolean;
  setFallbackEnabled: (v: boolean) => void;

  activeRun: ActiveRun | null;
  setActiveRun: (run: ActiveRun | null) => void;
  updateRunStatus: (status: AgentRunStatus, step?: string) => void;

  // Autonomy controls — sent to API; UI reflects optimistically
  pauseRun:  () => Promise<void>;
  resumeRun: () => Promise<void>;
  stopRun:   () => Promise<void>;
  killRun:   () => Promise<void>;
}

async function runControl(runId: string, action: string): Promise<void> {
  await fetch(`/api/runs/${runId}/${action}`, { method: 'POST' });
}

export const useRunStore = create<RunState>()(
  persist<RunState>(
    (set, get) => ({
      selectedProvider: 'ollama',
      selectedModel: 'llama3',
      setProvider: (provider: string) => set({ selectedProvider: provider }),
      setModel: (model: string) => set({ selectedModel: model }),

      fallbackEnabled: false,
      setFallbackEnabled: (v: boolean) => set({ fallbackEnabled: v }),

      activeRun: null,
      setActiveRun: (run: ActiveRun | null) => set({ activeRun: run }),
      updateRunStatus: (status: AgentRunStatus, step?: string) =>
        set((s) =>
          s.activeRun
            ? { activeRun: { ...s.activeRun, status, currentStep: step ?? s.activeRun.currentStep } }
            : {},
        ),

      pauseRun: async () => {
        const { activeRun } = get();
        if (!activeRun) return;
        await runControl(activeRun.id, 'pause');
        set({ activeRun: { ...activeRun, status: 'blocked' } });
      },

      resumeRun: async () => {
        const { activeRun } = get();
        if (!activeRun) return;
        await runControl(activeRun.id, 'resume');
        set({ activeRun: { ...activeRun, status: 'running' } });
      },

      stopRun: async () => {
        const { activeRun } = get();
        if (!activeRun) return;
        await runControl(activeRun.id, 'stop');
        set({ activeRun: null });
      },

      killRun: async () => {
        const { activeRun } = get();
        if (!activeRun) return;
        await runControl(activeRun.id, 'kill');
        set({ activeRun: null });
      },
    }),
    {
      name: 'abw-run',
      partialize: (s) =>
        ({
          selectedProvider: s.selectedProvider,
          selectedModel: s.selectedModel,
          fallbackEnabled: s.fallbackEnabled,
          activeRun: null, // never persist active run across page loads
        } as RunState),
    },
  ),
);
