// apps/web/src/layout/LeftPanel/ChatThread.tsx — streaming chat UI.
// Messages persist in chatStore; survive left panel collapse/reopen.
// When a run is active, subscribes to Supabase Realtime run:{runId} channel
// and appends agent log events as assistant messages.
import { useRef, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useChatStore } from '../../lib/store/chatStore';
import { useRunStore } from '../../lib/store/runStore';

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
  const { activeRun } = useRunStore();
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

  function submit() {
    const text = draft.trim();
    if (!text) return;
    addMessage(PROJECT_ID, { role: 'user', content: text, runId: activeRun?.id });
    setDraft('');
    // Real send: POST /api/runs + start run with goal=text.
    // Stub: confirm intent until run system is wired.
    setTimeout(() => {
      addMessage(PROJECT_ID, {
        role:    'assistant',
        content: `Got it — I'll start working on: "${text}". (Connect the API to begin a real run.)`,
      });
    }, 300);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  const isRunning = activeRun?.status === 'running' || activeRun?.status === 'planning';

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
          placeholder={isRunning ? 'Run in progress…' : 'Describe what to build… (Enter to send)'}
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
