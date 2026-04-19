// apps/web/src/layout/LeftPanel/ChatThread.tsx — streaming chat UI.
// Messages persist in chatStore; survive left panel collapse/reopen.
// When a run is active, subscribes to Supabase Realtime run:{runId} channel
// and appends agent log events as assistant messages.
import { useRef, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useChatStore } from '../../lib/store/chatStore';
import { useRunStore } from '../../lib/store/runStore';
import { useAuthStore } from '../../lib/store/authStore';

const API_BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3007';

const PROJECT_ID = 'global'; // replaced with real projectId once project routing exists

// ── Realtime subscription ──────────────────────────────────────────────────────
//
// Supabase Realtime is optional at dev time. If VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// are not set, the subscription silently skips. The UI falls back to polling
// /api/runs/:id for status updates instead.

interface RealtimeMessage {
  type: string;
  level?: string;
  message?: string;
  summary?: string;
  error?: string;
}

async function trySubscribeToRun(
  runId:   string,
  onEvent: (msg: RealtimeMessage) => void,
): Promise<(() => void) | null> {
  const url  = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
  const key  = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;
  if (!url || !key) return null;

  try {
    // Dynamic import — avoids bundling the Supabase client when not configured
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key);
    const channel  = supabase.channel(`run:${runId}`);

    channel.on('broadcast', { event: '*' }, ({ payload }: { payload: RealtimeMessage }) => {
      onEvent(payload);
    });

    await channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  } catch {
    return null;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ChatThread() {
  const messages = useChatStore((s) => s.messagesByProject[PROJECT_ID] ?? []);
  const { addMessage, appendToLast } = useChatStore();
  const { activeRun, selectedProvider, selectedModel } = useRunStore();
  const [draft, setDraft] = useState('');
  const bottomRef         = useRef<HTMLDivElement>(null);
  const textareaRef       = useRef<HTMLTextAreaElement>(null);
  const unsubRef          = useRef<(() => void) | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Subscribe to Realtime when run becomes active
  useEffect(() => {
    const runId = activeRun?.id;
    if (!runId) return;

    // Announce run start in chat
    addMessage(PROJECT_ID, {
      role:    'assistant',
      content: `▶ Run started — goal: "${activeRun.goal ?? 'unknown'}"`,
      runId,
    });

    void trySubscribeToRun(runId, (msg: RealtimeMessage) => {
      if (msg.type === 'log' && msg.message) {
        // Append log lines to the last assistant message (streaming feel)
        appendToLast(PROJECT_ID, `\n[${(msg.level ?? 'info').toUpperCase()}] ${msg.message}`);
      } else if (msg.type === 'completed' && msg.summary) {
        addMessage(PROJECT_ID, { role: 'assistant', content: `✓ Completed: ${msg.summary}`, runId });
      } else if (msg.type === 'failed' && msg.error) {
        addMessage(PROJECT_ID, { role: 'assistant', content: `✗ Failed: ${msg.error}`, runId });
      } else if (msg.type === 'paused') {
        addMessage(PROJECT_ID, { role: 'assistant', content: '⏸ Run paused.', runId });
      }
    }).then((unsub) => { if (unsub) unsubRef.current = unsub; });

    return () => { unsubRef.current?.(); unsubRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun?.id]);

  async function submit() {
    const text = draft.trim();
    if (!text) return;

    // Snapshot conversation history to send as context
    const history = (messages ?? []).slice(-20).map((m) => ({
      role:    m.role as 'user' | 'assistant',
      content: m.content,
    }));

    addMessage(PROJECT_ID, { role: 'user', content: text, runId: activeRun?.id });
    setDraft('');

    // Optimistically add an empty assistant message we'll stream into
    addMessage(PROJECT_ID, { role: 'assistant', content: '' });

    try {
      const session = useAuthStore.getState().session;
      const token   = session?.access_token;
      if (!token) {
        appendToLast(PROJECT_ID, '(Not signed in — please refresh and log in again.)');
        return;
      }

      const res = await fetch(`${API_BASE}/api/chat`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: [
            ...history,
            { role: 'user', content: text },
          ],
          provider: selectedProvider,
          model:    selectedModel,
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        appendToLast(PROJECT_ID, `Error: ${err.error ?? 'Unknown error'}`);
        return;
      }

      // Read SSE stream and append delta tokens to the last message
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;
          try {
            const event = JSON.parse(raw) as { type: string; delta?: string; error?: string };
            if (event.type === 'delta' && event.delta) {
              appendToLast(PROJECT_ID, event.delta);
            } else if (event.type === 'error') {
              appendToLast(PROJECT_ID, `\n\n⚠ ${event.error}`);
            }
          } catch { /* malformed SSE line */ }
        }
      }
    } catch (err) {
      appendToLast(PROJECT_ID, `\n\nNetwork error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const [sending, setSending] = useState(false);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sending) { setSending(true); void submit().finally(() => setSending(false)); }
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sending) { setSending(true); void submit().finally(() => setSending(false)); }
  }

  const isRunning = sending || activeRun?.status === 'running' || activeRun?.status === 'planning';

  return (
    <div className="abw-chat" aria-label="Chat thread">
      {/* Active run banner */}
      {isRunning && (
        <div className="abw-chat__run-banner" role="status" aria-live="polite">
          <span className="abw-chat__run-dot" aria-hidden />
          Run in progress
        </div>
      )}

      {/* Message list */}
      <div className="abw-chat__messages" role="log" aria-live="polite" aria-label="Messages">
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', textAlign: 'center', padding: 'var(--space-4) 0' }}>
            <div style={{ fontSize: '1.5rem', opacity: 0.3, marginBottom: 'var(--space-2)' }}>💬</div>
            <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>No messages yet</div>
            <div>Describe what you want to build.</div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`abw-chat__msg abw-chat__msg--${msg.role}`}>
            <div className="abw-chat__bubble">{msg.content}</div>
          </div>
        ))}
        <div ref={bottomRef} aria-hidden />
      </div>

      {/* Input row */}
      <form className="abw-chat__input-row" onSubmit={onSubmit} aria-label="Send message">
        <textarea
          ref={textareaRef}
          className="abw-chat__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={sending ? 'Thinking…' : isRunning ? 'Run in progress…' : 'Describe what to build… (Enter to send)'}
          rows={1}
          aria-label="Message input"
          disabled={isRunning}
        />
        <button
          type="submit"
          disabled={!draft.trim() || isRunning}
          style={{
            height: 36, padding: '0 var(--space-3)',
            border: 'none', borderRadius: 'var(--radius-button)',
            background: 'var(--accent-500)', color: '#fff',
            cursor: draft.trim() && !isRunning ? 'pointer' : 'default',
            opacity: draft.trim() && !isRunning ? 1 : 0.4,
            fontWeight: 600, fontSize: '0.8125rem', flexShrink: 0,
            transition: 'opacity var(--duration-fast) var(--ease-standard)',
          }}
          aria-label="Send"
        >
          Send
        </button>
      </form>
    </div>
  );
}
