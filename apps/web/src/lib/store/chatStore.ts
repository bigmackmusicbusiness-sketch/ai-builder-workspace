// apps/web/src/lib/store/chatStore.ts — chat thread state per project.
// Messages persist to localStorage via Zustand persist middleware.
// Each project gets its own message list keyed by projectId.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  runId?: string; // links message to an agent run
}

interface ChatState {
  /** Keyed by projectId. 'global' for no project context. */
  messagesByProject: Record<string, ChatMessage[]>;
  addMessage: (projectId: string, msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  appendToLast: (projectId: string, content: string) => void;
  clearProject: (projectId: string) => void;
}

// Cap per-project history to prevent localStorage bloat (~200 msgs ≈ ~100KB)
const MAX_MSGS = 200;

let _idCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++_idCounter}`;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messagesByProject: {},

      addMessage: (projectId: string, msg: Omit<ChatMessage, 'id' | 'timestamp'>) =>
        set((s) => {
          const prev = s.messagesByProject[projectId] ?? [];
          const newMsg: ChatMessage = { ...msg, id: nextId(), timestamp: Date.now() };
          const next = [...prev, newMsg];
          return {
            messagesByProject: {
              ...s.messagesByProject,
              [projectId]: next.length > MAX_MSGS ? next.slice(next.length - MAX_MSGS) : next,
            },
          };
        }),

      appendToLast: (projectId: string, delta: string) =>
        set((s) => {
          const prev = s.messagesByProject[projectId];
          if (!prev || prev.length === 0) return {};
          const lastMsg = prev[prev.length - 1];
          if (!lastMsg) return {};
          const updated: ChatMessage = { ...lastMsg, content: lastMsg.content + delta };
          return {
            messagesByProject: {
              ...s.messagesByProject,
              [projectId]: [...prev.slice(0, -1), updated],
            },
          };
        }),

      clearProject: (projectId: string) =>
        set((s) => ({
          messagesByProject: { ...s.messagesByProject, [projectId]: [] },
        })),
    }),
    {
      name: 'abw-chat',
      // Only persist message history — not the action functions
      partialize: (s) => ({ messagesByProject: s.messagesByProject } as ChatState),
    },
  ),
);
