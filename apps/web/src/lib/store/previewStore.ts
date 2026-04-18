// apps/web/src/lib/store/previewStore.ts — preview session state + log buffer.
// Drives PreviewMode iframe + ConsoleMode log stream.
import { create } from 'zustand';

export type SessionStatus =
  | 'idle' | 'queued' | 'bundling' | 'syncing' | 'booted' | 'error' | 'stopped';

export interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
}

export interface ProcessInfo {
  name: string;
  status: 'running' | 'stopped' | 'error';
  startedAt: number;
  error?: string;
}

export interface PreviewSession {
  sessionId: string;
  projectSlug: string;
  previewUrl: string;
  status: SessionStatus;
  processes: ProcessInfo[];
  error?: string;
}

interface PreviewState {
  session: PreviewSession | null;
  logs: LogEntry[];
  /** Current viewport width in px; 0 = fill parent (full). */
  viewportWidth: number;
  /** Current route path shown in the URL bar. */
  currentRoute: string;

  setSession: (s: PreviewSession | null) => void;
  updateSession: (patch: Partial<PreviewSession>) => void;
  appendLogs: (entries: LogEntry[]) => void;
  clearLogs: () => void;
  setViewportWidth: (w: number) => void;
  setCurrentRoute: (r: string) => void;
}

export const usePreviewStore = create<PreviewState>()((set) => ({
  session: null,
  logs: [],
  viewportWidth: 0,
  currentRoute: '/',

  setSession: (s) => set({ session: s }),
  updateSession: (patch) =>
    set((state) =>
      state.session ? { session: { ...state.session, ...patch } } : {},
    ),
  appendLogs: (entries) =>
    set((state) => {
      const next = [...state.logs, ...entries];
      // Cap at 2000 log lines in browser
      return { logs: next.length > 2000 ? next.slice(next.length - 2000) : next };
    }),
  clearLogs: () => set({ logs: [] }),
  setViewportWidth: (w) => set({ viewportWidth: w }),
  setCurrentRoute: (r) => set({ currentRoute: r }),
}));
