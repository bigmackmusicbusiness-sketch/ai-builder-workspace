// apps/web/src/lib/store/chatStore.ts — chat thread state per project.
// Messages survive left panel collapse (store lives outside component tree).
import { create } from 'zustand';

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

let _idCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++_idCounter}`;
}

export const useChatStore = create<ChatState>()((set) => ({
  messagesByProject: {},

  addMessage: (projectId: string, msg: Omit<ChatMessage, 'id' | 'timestamp'>) =>
    set((s) => {
      const prev = s.messagesByProject[projectId] ?? [];
      const newMsg: ChatMessage = { ...msg, id: nextId(), timestamp: Date.now() };
      return {
        messagesByProject: {
          ...s.messagesByProject,
          [projectId]: [...prev, newMsg],
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
}));
