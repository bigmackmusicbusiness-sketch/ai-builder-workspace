// apps/web/src/lib/store/projectStore.ts — per-project registry and memory banks.
// Each project gets an isolated memory bank: goal, decisions, files, issues.
// Memory is persisted to localStorage and injected as a system prompt on every chat.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch } from '../api';

// Must stay in sync with packages/project-types
export type ProjectTypeId =
  | 'website'
  | 'landing-page'
  | 'dashboard'
  | 'internal-tool'
  | 'onboarding-flow'
  | 'automation-panel'
  | 'saas-app'
  | 'api-service'
  | 'full-stack-app'
  | 'ebook'
  | 'document'
  | 'email-composer'
  | 'music-studio'
  | 'ai-movie'
  | 'ai-commercial'
  | 'ai-short'
  | 'ai-music-video'
  | 'blank';

export type ProjectEnv = 'dev' | 'staging' | 'preview' | 'production';

/** Agent memory bank — one per project, grows as the AI works. */
export interface ProjectMemory {
  /** Top-level goal the user set for this project. */
  goal: string;
  /** Ordered list of recent architectural / tech decisions. */
  recentDecisions: string[];
  /** Files modified in recent runs (last 10). */
  affectedFiles: string[];
  /** Known bugs or blockers (agent-maintained). */
  knownIssues: string[];
  /** Recently completed tasks (last 10). */
  completedTasks: string[];
  /** Tech stack detected or declared (e.g. React, Vite, Fastify). */
  techStack: string[];
  /** ISO timestamp of last memory update. */
  lastUpdated: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  typeId: ProjectTypeId;
  env: ProjectEnv;
  description?: string;
  createdAt: number;
  lastActiveAt: number;
  /** Agent memory bank — isolated per project. */
  memory: ProjectMemory;
  /** Whether this project is shared with other tenant members. */
  isShared?: boolean;
  /** UUID of the user who owns the project. */
  createdBy?: string;
}

/** Shape of a project row coming back from GET /api/projects */
export interface DBProjectRow {
  id:          string;
  name:        string;
  slug:        string;
  type:        string;   // underscore variant: 'landing_page' etc.
  description: string | null;
  activeEnv:   string;
  createdAt:   string;   // ISO string from DB
  updatedAt:   string;
  isShared?:   boolean;
  createdBy?:  string | null;
}

interface ProjectState {
  /** Currently active project; 'global' = no project selected. */
  currentProjectId: string;
  /** All known projects, keyed by id. */
  projects: Record<string, ProjectRecord>;

  setCurrentProject: (id: string) => void;
  createProject: (opts: { id: string; name: string; slug: string; typeId: ProjectTypeId; env?: ProjectEnv; description?: string }) => void;
  deleteProject: (id: string) => void;
  /**
   * Replace the project list with authoritative data from the DB.
   * Preserves per-project agent memory stored locally.
   * Projects absent from the DB are removed from local state.
   */
  syncFromDB: (rows: DBProjectRow[]) => void;
  /** Fetch projects from GET /api/projects and sync into local store. Non-fatal on error. */
  loadProjectsFromServer: () => Promise<void>;
  /** Owner-only: toggle whether the project is shared with the tenant. */
  toggleShare: (id: string, isShared: boolean) => void;
  updateMemory: (id: string, patch: Partial<ProjectMemory>) => void;
  addDecision: (id: string, decision: string) => void;
  addCompletedTask: (id: string, task: string) => void;
  addAffectedFile: (id: string, file: string) => void;
  setGoal: (id: string, goal: string) => void;
  touchProject: (id: string) => void;
}

function emptyMemory(): ProjectMemory {
  return {
    goal: '',
    recentDecisions: [],
    affectedFiles: [],
    knownIssues: [],
    completedTasks: [],
    techStack: [],
    lastUpdated: Date.now(),
  };
}

function trimList<T>(arr: T[], max: number): T[] {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      currentProjectId: 'global',
      projects: {},

      setCurrentProject: (id) => {
        set({ currentProjectId: id });
        // Touch last-active timestamp
        get().touchProject(id);
      },

      createProject: ({ id, name, slug, typeId, env = 'dev', description }) => {
        const project: ProjectRecord = {
          id,
          name,
          slug,
          typeId,
          env,
          description,
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          memory: emptyMemory(),
        };
        set((s) => ({
          projects: { ...s.projects, [id]: project },
          currentProjectId: id, // switch to the new project immediately
        }));
      },

      deleteProject: (id) =>
        set((s) => {
          const { [id]: _removed, ...rest } = s.projects;
          return {
            projects: rest,
            currentProjectId: s.currentProjectId === id ? 'global' : s.currentProjectId,
          };
        }),

      syncFromDB: (rows) =>
        set((s) => {
          const next: Record<string, ProjectRecord> = {};
          for (const row of rows) {
            // Map DB underscore type → store hyphen typeId (e.g. landing_page → landing-page)
            const typeId = row.type.replace(/_/g, '-') as ProjectTypeId;
            const existing = s.projects[row.id];
            next[row.id] = {
              id:           row.id,
              name:         row.name,
              slug:         row.slug,
              typeId,
              env:          (row.activeEnv as ProjectEnv) ?? 'dev',
              description:  row.description ?? undefined,
              createdAt:    new Date(row.createdAt).getTime(),
              // Preserve local lastActiveAt if we've opened it before; else use DB updatedAt
              lastActiveAt: existing?.lastActiveAt ?? new Date(row.updatedAt ?? row.createdAt).getTime(),
              // Always preserve agent memory — it lives only in localStorage
              memory: existing?.memory ?? emptyMemory(),
              isShared:  row.isShared ?? false,
              createdBy: row.createdBy ?? undefined,
            };
          }
          // If the active project was deleted elsewhere, fall back to global
          const stillActive =
            s.currentProjectId === 'global' || next[s.currentProjectId] !== undefined;
          return {
            projects: next,
            currentProjectId: stillActive ? s.currentProjectId : 'global',
          };
        }),

      toggleShare: (id, isShared) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return {};
          return { projects: { ...s.projects, [id]: { ...p, isShared } } };
        }),

      updateMemory: (id, patch) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return {};
          return {
            projects: {
              ...s.projects,
              [id]: {
                ...p,
                lastActiveAt: Date.now(),
                memory: { ...p.memory, ...patch, lastUpdated: Date.now() },
              },
            },
          };
        }),

      addDecision: (id, decision) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return {};
          return {
            projects: {
              ...s.projects,
              [id]: {
                ...p,
                lastActiveAt: Date.now(),
                memory: {
                  ...p.memory,
                  recentDecisions: trimList([...p.memory.recentDecisions, decision], 20),
                  lastUpdated: Date.now(),
                },
              },
            },
          };
        }),

      addCompletedTask: (id, task) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return {};
          return {
            projects: {
              ...s.projects,
              [id]: {
                ...p,
                lastActiveAt: Date.now(),
                memory: {
                  ...p.memory,
                  completedTasks: trimList([...p.memory.completedTasks, task], 20),
                  lastUpdated: Date.now(),
                },
              },
            },
          };
        }),

      addAffectedFile: (id, file) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return {};
          // Deduplicate: move file to end if already present
          const prev = p.memory.affectedFiles.filter((f) => f !== file);
          return {
            projects: {
              ...s.projects,
              [id]: {
                ...p,
                lastActiveAt: Date.now(),
                memory: {
                  ...p.memory,
                  affectedFiles: trimList([...prev, file], 20),
                  lastUpdated: Date.now(),
                },
              },
            },
          };
        }),

      setGoal: (id, goal) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return {};
          return {
            projects: {
              ...s.projects,
              [id]: {
                ...p,
                memory: { ...p.memory, goal, lastUpdated: Date.now() },
              },
            },
          };
        }),

      touchProject: (id) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return {};
          return {
            projects: {
              ...s.projects,
              [id]: { ...p, lastActiveAt: Date.now() },
            },
          };
        }),

      loadProjectsFromServer: async () => {
        try {
          const data = await apiFetch<{ projects: DBProjectRow[] }>('/api/projects');
          if (Array.isArray(data.projects)) {
            get().syncFromDB(data.projects);
          }
        } catch {
          // Non-fatal — use cached localStorage data when offline or not yet authenticated
        }
      },
    }),
    {
      name: 'abw-projects',
      partialize: (s) =>
        ({ currentProjectId: s.currentProjectId, projects: s.projects } as ProjectState),
    },
  ),
);

// ── System prompt builder ──────────────────────────────────────────────────────

/**
 * Builds the AI system prompt for a given project's memory bank.
 * Injected as the first message on every chat request.
 */
export function buildSystemPrompt(project: ProjectRecord | undefined): string {
  const base =
    'You are an expert full-stack developer and AI agent assistant embedded in the AI Builder Workspace (ABW). ' +
    'You help users build, debug, ship, and improve web applications. ' +
    'Be concise and actionable. When suggesting code changes, include the exact file path and diff.';

  if (!project || project.id === 'global') return base;

  const lines: string[] = [
    `You are an expert full-stack developer and AI agent working on the project "${project.name}" (type: ${project.typeId}).`,
    `Current environment: ${project.env}.`,
  ];

  if (project.description) {
    lines.push(`Project description: ${project.description}`);
  }
  if (project.memory.goal) {
    lines.push(`Active goal: ${project.memory.goal}`);
  }
  if (project.memory.techStack.length > 0) {
    lines.push(`Tech stack: ${project.memory.techStack.join(', ')}.`);
  }
  if (project.memory.affectedFiles.length > 0) {
    lines.push(`Recently modified files: ${project.memory.affectedFiles.slice(-5).join(', ')}.`);
  }
  if (project.memory.recentDecisions.length > 0) {
    lines.push(`Recent decisions: ${project.memory.recentDecisions.slice(-3).join(' | ')}.`);
  }
  if (project.memory.knownIssues.length > 0) {
    lines.push(`Known issues: ${project.memory.knownIssues.join(' | ')}.`);
  }
  if (project.memory.completedTasks.length > 0) {
    lines.push(`Recently completed: ${project.memory.completedTasks.slice(-5).join(', ')}.`);
  }

  lines.push(
    'Be concise and actionable. When suggesting code changes, specify the exact file path and the precise diff.',
  );

  return lines.join('\n');
}
