// apps/web/src/lib/store/runStore.ts — per-run model selection + active run state.
// selectedProvider/selectedModel are always visible in the UI and pinned to every run.
// No silent fallback: fallbackEnabled default is false.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch } from '../api';

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

  /** Huashu Design skill toggle — when ON, the agent gets the design.run_huashu tool
   *  and a system prompt prelude that biases it toward producing visual deliverables
   *  (HTML prototypes, slide decks, infographics, animations). Off by default. */
  designSkillsEnabled: boolean;
  setDesignSkillsEnabled: (v: boolean) => void;

  /** Replicate gen toggle (curated cost-effective models — video gen + Ideogram inpaint
   *  for Ads Studio AI text edit). Off by default. Requires REPLICATE_API_TOKEN in vault.
   *
   *  Higgsfield was removed from the active surfaces in the 2026-05 internal-live
   *  update — the provider files stay on disk (orchestrator imports them) but the
   *  chat composer no longer offers a toggle and the agent tool registry no
   *  longer registers higgsfield_* tools. Dedicated /video screen still works. */
  replicateEnabled: boolean;
  setReplicateEnabled: (v: boolean) => void;

  /** AI text-edit toggle (gates Replicate Ideogram v2 inpainting in the Ads
   *  Studio image editor). Off by default — same opt-in pattern as the
   *  Replicate video toggle, since each call costs ~$0.08. Manual canvas
   *  text editing is always available regardless of this flag. */
  aiEditEnabled: boolean;
  setAiEditEnabled: (v: boolean) => void;

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
  await apiFetch(`/api/runs/${runId}/${action}`, { method: 'POST' });
}

export const useRunStore = create<RunState>()(
  persist<RunState>(
    (set, get) => ({
      selectedProvider: 'minimax',
      selectedModel: 'MiniMax-M2.7',
      setProvider: (provider: string) => set({ selectedProvider: provider }),
      setModel: (model: string) => set({ selectedModel: model }),

      fallbackEnabled: false,
      setFallbackEnabled: (v: boolean) => set({ fallbackEnabled: v }),

      designSkillsEnabled: false,
      setDesignSkillsEnabled: (v: boolean) => set({ designSkillsEnabled: v }),

      replicateEnabled: false,
      setReplicateEnabled: (v: boolean) => set({ replicateEnabled: v }),

      aiEditEnabled: false,
      setAiEditEnabled: (v: boolean) => set({ aiEditEnabled: v }),

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
          selectedProvider:    s.selectedProvider,
          selectedModel:       s.selectedModel,
          fallbackEnabled:     s.fallbackEnabled,
          designSkillsEnabled: s.designSkillsEnabled,
          replicateEnabled:    s.replicateEnabled,
          aiEditEnabled:       s.aiEditEnabled,
          activeRun: null, // never persist active run across page loads
        } as RunState),
    },
  ),
);
