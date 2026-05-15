// apps/web/src/lib/store/chatStore.ts — chat thread state per project.
//
// Round 15.1: the DB is now the source of truth for IDE chat history.
// Messages persist to `chat_messages` server-side (see chat.ts +
// db/chatMessages.ts on the api), AND a local cache lives in localStorage
// for fast first-paint + offline rendering. On project open, the SPA
// calls hydrateFromServer() to replace the local cache with whatever the
// server has. That means different browser / cleared cache / new device
// still sees the conversation — what used to be lost to localStorage.
//
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
  /** Set true once hydrateFromServer has resolved for a given projectId,
   *  so ChatThread can render a "loading…" placeholder for the first
   *  paint only. Per-project. */
  hydratedProjects: Record<string, boolean>;
  addMessage: (projectId: string, msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  appendToLast: (projectId: string, content: string) => void;
  clearProject: (projectId: string) => void;
  /** Replace the entire message list for a project. Used by hydrateFromServer
   *  to swap the localStorage cache for server-authoritative history. */
  setProjectMessages: (projectId: string, messages: ChatMessage[]) => void;
  markHydrated: (projectId: string) => void;
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
      hydratedProjects:  {},

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

      setProjectMessages: (projectId: string, messages: ChatMessage[]) =>
        set((s) => ({
          messagesByProject: {
            ...s.messagesByProject,
            [projectId]: messages.length > MAX_MSGS ? messages.slice(messages.length - MAX_MSGS) : messages,
          },
        })),

      markHydrated: (projectId: string) =>
        set((s) => ({
          hydratedProjects: { ...s.hydratedProjects, [projectId]: true },
        })),
    }),
    {
      name: 'abw-chat',
      // Only persist message history — not the action functions or the
      // hydration flag (hydration is a per-session signal, not persistent).
      partialize: (s) => ({
        messagesByProject: s.messagesByProject,
      } as ChatState),
    },
  ),
);

// ── Server hydration ─────────────────────────────────────────────────────────

interface DbChatRow {
  role:         'user' | 'assistant' | 'tool' | 'system';
  content:      string | null;
  tool_calls:   unknown;   // jsonb — array of ToolCall or null
  tool_call_id: string | null;
  metadata:     Record<string, unknown> | null;
  created_at:   string;
}

/** Map a server chat_messages row into the local ChatMessage shape.
 *  Returns null for rows that don't render as a top-level chat bubble
 *  (system, empty assistant turns with only tool_calls — those render
 *  inline as cards during live streams, but the post-hoc replay shows
 *  only the conversational text). */
function rowToChatMessage(row: DbChatRow, idSeed: number): ChatMessage | null {
  // Skip system messages (build directives, OWASP preludes) — they're
  // injected per turn, not part of the user-visible conversation.
  if (row.role === 'system') return null;

  // Skip tool result rows — the live stream renders these as cards via
  // tool_result SSE events; on hydration we don't have the same UI, so
  // we summarize tool activity by leaving an inline marker on the
  // preceding assistant turn (below). Returning null here just means
  // tool messages aren't their own chat bubbles in replay.
  if (row.role === 'tool') return null;

  // User and assistant rows: take the content as-is, or fall back to a
  // tool-activity marker if assistant text is null (model emitted only
  // tool_calls in that turn — common during build runs).
  let content = row.content ?? '';
  if (row.role === 'assistant' && !content && Array.isArray(row.tool_calls) && row.tool_calls.length > 0) {
    const names = (row.tool_calls as Array<{ function?: { name?: string } }>)
      .map((tc) => tc.function?.name)
      .filter((n): n is string => typeof n === 'string');
    content = names.length > 0 ? `_(used: ${names.join(', ')})_` : '_(tool turn)_';
  }
  if (!content && row.role === 'assistant') return null; // skip truly empty assistant rows

  const ts = (() => {
    const parsed = Date.parse(row.created_at);
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();

  return {
    id:        `srv-${ts}-${idSeed}`,
    role:      row.role,                  // 'user' | 'assistant' here (system+tool returned null above)
    content,
    timestamp: ts,
  };
}

/** Fetch persisted chat_messages from the api and replace the local cache
 *  for the given project. Idempotent. Silent on failure (logs to console)
 *  so the IDE keeps working off the localStorage cache when the api is
 *  unreachable. */
export async function hydrateChatFromServer(opts: {
  projectId:   string;
  projectSlug: string;
  apiBase:     string;
  token:       string;
}): Promise<void> {
  const { projectId, projectSlug, apiBase, token } = opts;
  // Snapshot what was already in local state BEFORE we issue the fetch.
  // The hydration window (~200-800ms) overlaps with user activity — if the
  // user sends a message during this window, `addMessage` appends to the
  // tail of `messagesByProject[projectId]`. After the fetch resolves we
  // diff `localAfter` against `localBefore` to recover anything added
  // mid-flight, so the server's authoritative history doesn't clobber a
  // just-sent user message. Without this guard, opening a project and
  // immediately typing produces a phantom-message bug: the SSE reply
  // still arrives but the user's prompt bubble disappears from the panel.
  const localBefore = useChatStore.getState().messagesByProject[projectId] ?? [];
  try {
    const res = await fetch(`${apiBase}/api/projects/${encodeURIComponent(projectSlug)}/chat-history`, {
      method:  'GET',
      headers: {
        'Authorization':    `Bearer ${token}`,
        'X-Requested-With': 'fetch',
      },
    });
    if (!res.ok) {
      // Not fatal — 404 = no project yet, 500 = transient. Either way,
      // localStorage cache stays in place.
      return;
    }
    const body = await res.json() as { messages: DbChatRow[] };
    if (!Array.isArray(body.messages)) return;
    const mapped = body.messages
      .map((row, i) => rowToChatMessage(row, i))
      .filter((m): m is ChatMessage => m !== null);
    // Find any messages added to local state during the fetch window.
    // Zustand's addMessage always appends, so they sit at the tail past
    // the localBefore.length boundary.
    const localAfter        = useChatStore.getState().messagesByProject[projectId] ?? [];
    const addedDuringFetch  = localAfter.slice(localBefore.length);
    // Splice them after the server's authoritative history so the user
    // sees: [persisted server messages] → [their in-flight new message].
    const merged = [...mapped, ...addedDuringFetch];
    useChatStore.getState().setProjectMessages(projectId, merged);
    useChatStore.getState().markHydrated(projectId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[chatStore] hydrate failed:', err);
  }
}
