// apps/web/src/layout/LeftPanel/ChatThread.tsx — streaming chat UI with media attachments.
//
// UX changes (Phase B redesign):
//   * Textarea auto-grows up to min(50vh, 360px), then internal scroll.
//   * "Expand" button (or Cmd/Ctrl+E) opens a docked composer overlay that fills the
//     workspace area to the right of the LeftPanel for long prompts.
//   * Messages render through MarkdownContent (GFM + syntax-highlighted code blocks).
//   * Tool events render as styled "tool chips" inside the assistant bubble.
//   * StatusPill (model + agent status) sits above the input, replacing the old
//     fixed AgentStatus + ModelSelector sections.
//
// Paperclip button lets the user attach images/files; images are vision-forwarded.
// Logo detection and browser-side color extraction happen before the chat POST.
// Messages persist in chatStore (localStorage) keyed by projectId.
import { useRef, useEffect, useState, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { useChatStore, hydrateChatFromServer } from '../../lib/store/chatStore';
import { useRunStore } from '../../lib/store/runStore';
import { useAuthStore } from '../../lib/store/authStore';
import { useProjectStore, buildSystemPrompt } from '../../lib/store/projectStore';
import { apiFetchForm } from '../../lib/api';
import { Toggle } from '@abw/ui';
import { MarkdownContent } from './MarkdownContent';
import { ApprovalsQueue } from './ApprovalsQueue';
import { StatusPill } from './StatusPill';
import { PlatformMediaPicker, type LibraryAsset } from './PlatformMediaPicker';

const API_BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3007';

// ── Attachment types ───────────────────────────────────────────────────────────

interface Attachment {
  file:       File;
  previewUrl: string;
  isImage:    boolean;
  isLogo:     boolean;
  colors:     string[];
  uploading:  boolean;
  uploadedUrl?: string;
  assetId?:   string;
}

// ── Color extraction + logo detection ─────────────────────────────────────────

async function analyzeImage(
  file: File,
): Promise<{ colors: string[]; isLogo: boolean }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const name        = file.name.toLowerCase();
      const isLogoByName = /logo|brand|icon|mark/.test(name);
      const smallImg    = img.width < 400 && img.height < 400;

      const size = Math.min(img.width, img.height, 80);
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) {
        resolve({ colors: [], isLogo: isLogoByName });
        return;
      }
      ctx2d.drawImage(img, 0, 0, size, size);
      const data = ctx2d.getImageData(0, 0, size, size).data;

      const counts = new Map<string, number>();
      for (let i = 0; i < data.length; i += 16) {
        if ((data[i + 3] ?? 0) < 128) continue;
        const r = Math.round((data[i]     ?? 0) / 32) * 32;
        const g = Math.round((data[i + 1] ?? 0) / 32) * 32;
        const b = Math.round((data[i + 2] ?? 0) / 32) * 32;
        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        counts.set(hex, (counts.get(hex) ?? 0) + 1);
      }

      const sorted      = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const uniqueCount = counts.size;
      const isLogo      = isLogoByName || (smallImg && uniqueCount < 20);

      resolve({ colors: sorted.slice(0, 3).map(([h]) => h), isLogo });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ colors: [], isLogo: /logo|brand|icon|mark/.test(file.name.toLowerCase()) });
    };

    img.src = url;
  });
}

// ── Realtime subscription ──────────────────────────────────────────────────────

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

// ── Tool-event formatting ──────────────────────────────────────────────────────

function extractPath(argsJson: string): string | null {
  if (!argsJson) return null;
  try {
    const parsed = JSON.parse(argsJson) as { path?: unknown };
    return typeof parsed.path === 'string' ? parsed.path : null;
  } catch {
    const m = argsJson.match(/"path"\s*:\s*"([^"]+)"/);
    return m?.[1] ?? null;
  }
}

function formatToolStart(name: string, argsJson: string): string {
  const path = extractPath(argsJson);
  if (name === 'gen_image') {
    let promptHint = '';
    try {
      const p = (JSON.parse(argsJson) as { prompt?: string }).prompt ?? '';
      promptHint = p.length > 50 ? p.slice(0, 50) + '…' : p;
    } catch {
      const m = argsJson.match(/"prompt"\s*:\s*"([^"]{0,50})/);
      promptHint = m?.[1] ?? '';
    }
    return `🎨 Generating image${promptHint ? `: "${promptHint}"` : '…'}`;
  }
  return (
    name === 'write_file'  ? `📝 Writing ${path ?? '…'}` :
    name === 'read_file'   ? `👀 Reading ${path ?? '…'}` :
    name === 'delete_file' ? `🗑 Deleting ${path ?? '…'}` :
    name === 'list_files'  ? '📂 Listing workspace files' :
    `⚙ ${name}${path ? ` ${path}` : ''}`
  );
}

// ── Auto-grow textarea hook ────────────────────────────────────────────────────

function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement>, value: string, maxHeight: number) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = next + 'px';
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [ref, value, maxHeight]);
}

// ── Local upload tab (used inside the paperclip popover) ──────────────────────
//
// Big drop-zone CTA + a click-to-pick fallback. Drag/drop uses the file
// list directly. Click delegates to the hidden <input type=file> in the
// parent form.
function LocalUploadTab({
  onPick,
  onFiles,
}: {
  onPick:  () => void;
  onFiles: (files: FileList | null) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onFiles(e.dataTransfer.files);
        }
      }}
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); }
      }}
      style={{
        margin: 'var(--space-2)',
        padding: 'var(--space-4)',
        border: `2px dashed ${dragOver ? 'var(--accent-500)' : 'var(--border-base)'}`,
        borderRadius: 'var(--radius-card)',
        background: dragOver ? 'var(--accent-50)' : 'var(--bg-subtle)',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'background var(--duration-fast), border-color var(--duration-fast)',
      }}
      aria-label="Drop files here or click to browse"
    >
      <div style={{ fontSize: '1.5rem', marginBottom: 'var(--space-1)' }} aria-hidden>📤</div>
      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
        Drop files here or click to browse
      </div>
      <div style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
        Images, video, audio, or PDF · up to 5 files
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ChatThread() {
  const currentProjectId          = useProjectStore((s) => s.currentProjectId);
  const currentProject            = useProjectStore((s) => s.projects[s.currentProjectId]);
  const messages                  = useChatStore((s) => s.messagesByProject[currentProjectId] ?? []);
  const { addMessage, appendToLast } = useChatStore();
  const {
    activeRun,
    selectedProvider, selectedModel,
    designSkillsEnabled, setDesignSkillsEnabled,
    replicateEnabled,    setReplicateEnabled,
  } = useRunStore();
  const [draft, setDraft]             = useState('');
  const [sending, setSending]         = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [expanded, setExpanded]       = useState(false);
  /** Paperclip popover open state. When true, render the 2-tab Local|Library picker.
   *  When false, the paperclip is a plain icon. */
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [pickerTab, setPickerTab]     = useState<'local' | 'library'>('local');
  const bottomRef                     = useRef<HTMLDivElement>(null);
  const textareaRef                   = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef           = useRef<HTMLTextAreaElement>(null);
  const fileInputRef                  = useRef<HTMLInputElement>(null);
  /** Wraps both the paperclip button + the popover so the outside-click handler
   *  can detect "click landed inside the picker tree" vs. "click landed elsewhere". */
  const pickerWrapRef                 = useRef<HTMLDivElement>(null);
  const unsubRef                      = useRef<(() => void) | null>(null);

  // Round 15.1: hydrate chat history from the server on project open.
  // The DB is the source of truth — localStorage is just a cache for fast
  // first-paint + offline rendering. Whenever the project changes, fetch
  // the canonical message list from /api/projects/:slug/chat-history and
  // replace local. Safe to no-op when there's no session yet (the SPA's
  // login flow re-runs effects once a session resolves).
  useEffect(() => {
    if (!currentProjectId || !currentProject?.slug) return;
    const session = useAuthStore.getState().session;
    const token   = session?.access_token;
    if (!token) return;
    void hydrateChatFromServer({
      projectId:   currentProjectId,
      projectSlug: currentProject.slug,
      apiBase:     API_BASE,
      token,
    });
  }, [currentProjectId, currentProject?.slug]);

  // Close paperclip popover on outside click + Escape. Without this, the only
  // ways out were the ✕ button or successfully picking a file — both feel
  // sticky compared to native popovers. Mirrors the pattern used in
  // TopBar's project switcher and settings menu.
  useEffect(() => {
    if (!pickerOpen) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(t)) {
        setPickerOpen(false);
      }
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  // Auto-grow the inline textarea up to 50vh (capped at 360px) — fixes the
  // "impossible to scroll your input" bug where the old hard 120px max trapped users.
  const inlineMaxHeight = Math.min(360, Math.round(window.innerHeight * 0.5));
  useAutoGrow(textareaRef, expanded ? '' : draft, inlineMaxHeight);
  useAutoGrow(expandedTextareaRef, expanded ? draft : '', Math.round(window.innerHeight * 0.7));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Cmd/Ctrl+E toggles expand mode for long prompts
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setExpanded((v) => !v);
      } else if (e.key === 'Escape' && expanded) {
        setExpanded(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Focus the right textarea when expand toggles
  useEffect(() => {
    const el = expanded ? expandedTextareaRef.current : textareaRef.current;
    if (el) {
      el.focus();
      // Move cursor to end
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [expanded]);

  useEffect(() => {
    const runId = activeRun?.id;
    if (!runId) return;

    addMessage(currentProjectId, {
      role:    'assistant',
      content: `▶ Run started — goal: "${activeRun.goal ?? 'unknown'}"`,
      runId,
    });

    void trySubscribeToRun(runId, (msg: RealtimeMessage) => {
      if (msg.type === 'log' && msg.message) {
        appendToLast(currentProjectId, `\n[${(msg.level ?? 'info').toUpperCase()}] ${msg.message}`);
      } else if (msg.type === 'completed' && msg.summary) {
        addMessage(currentProjectId, { role: 'assistant', content: `✓ Completed: ${msg.summary}`, runId });
      } else if (msg.type === 'failed' && msg.error) {
        addMessage(currentProjectId, { role: 'assistant', content: `✗ Failed: ${msg.error}`, runId });
      } else if (msg.type === 'paused') {
        addMessage(currentProjectId, { role: 'assistant', content: '⏸ Run paused.', runId });
      }
    }).then((unsub) => { if (unsub) unsubRef.current = unsub; });

    return () => { unsubRef.current?.(); unsubRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun?.id]);

  // ── File picker ────────────────────────────────────────────────────────────

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const MAX = 5;
    const available = MAX - attachments.length;
    if (available <= 0) return;

    const picked = Array.from(files).slice(0, available);
    const newAttachments: Attachment[] = picked.map((f) => ({
      file:       f,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
      isImage:    f.type.startsWith('image/'),
      isLogo:     false,
      colors:     [],
      uploading:  false,
    }));

    const analyzed = await Promise.all(
      newAttachments.map(async (att) => {
        if (!att.isImage) return att;
        const { colors, isLogo } = await analyzeImage(att.file);
        return { ...att, colors, isLogo };
      }),
    );

    setAttachments((prev) => [...prev, ...analyzed]);
  }, [attachments.length]);

  function removeAttachment(idx: number) {
    setAttachments((prev) => {
      const att = prev[idx];
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  /** Pick an existing asset from the Library tab — synthesize a minimal File-like
   *  attachment so the rest of the send pipeline doesn't have to know the
   *  difference. The chat backend already accepts attachments by `assetId`, so
   *  we don't re-upload — uploadedUrl is set up-front to skip the upload step. */
  const addLibraryAsset = useCallback((asset: LibraryAsset) => {
    if (attachments.length >= 5) return;
    // Minimal File stand-in. The send pipeline only reads .name and .type from
    // it (plus passes the buffer to /upload, which we skip via uploadedUrl).
    const stub = new File([new Blob()], asset.name, { type: asset.mimeType });
    const att: Attachment = {
      file:        stub,
      previewUrl:  asset.url,
      isImage:     asset.mimeType.startsWith('image/'),
      isLogo:      false,
      colors:      [],
      uploading:   false,
      uploadedUrl: asset.url,
      assetId:     asset.id,
    };
    setAttachments((prev) => [...prev, att]);
    setPickerOpen(false);
  }, [attachments.length]);

  // ── Upload attachments to API before sending ───────────────────────────────

  async function uploadAttachments(atts: Attachment[]): Promise<Attachment[]> {
    if (!currentProject) return atts;
    return Promise.all(atts.map(async (att) => {
      if (att.uploadedUrl) return att;
      try {
        const form = new FormData();
        form.append('file', att.file);
        const res = await apiFetchForm<{ asset: { id: string; url: string } }>(
          `/api/assets/upload?projectId=${currentProject.id}`,
          form,
        );
        return { ...att, uploadedUrl: res.asset.url, assetId: res.asset.id };
      } catch {
        return { ...att, uploadedUrl: att.previewUrl };
      }
    }));
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function submit() {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || sending) return;

    const history = messages
      .filter((m) => m.role !== 'system')
      .slice(-20)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const displayText = text || (attachments.length === 1
      ? `📎 ${attachments[0]?.file.name ?? 'file'}`
      : `📎 ${attachments.length} files`);

    addMessage(currentProjectId, { role: 'user', content: displayText, runId: activeRun?.id });
    setDraft('');
    setExpanded(false);

    let uploadedAtts = attachments;
    if (attachments.length > 0) {
      setAttachments((prev) => prev.map((a) => ({ ...a, uploading: true })));
      uploadedAtts = await uploadAttachments(attachments);
      setAttachments([]);
    }

    addMessage(currentProjectId, { role: 'assistant', content: '' });

    try {
      const session = useAuthStore.getState().session;
      const token   = session?.access_token;
      if (!token) {
        appendToLast(currentProjectId, '(Not signed in — please log in again.)');
        return;
      }

      const systemPrompt = buildSystemPrompt(currentProject);

      const chatAttachments = uploadedAtts
        .filter((a) => a.uploadedUrl)
        .map((a) => ({
          url:      a.uploadedUrl!,
          mimeType: a.file.type,
          name:     a.file.name,
          assetId:  a.assetId,
          isLogo:   a.isLogo,
          colors:   a.colors.length > 0 ? a.colors : undefined,
        }));

      const res = await fetch(`${API_BASE}/api/chat`, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'Authorization':    `Bearer ${token}`,
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: text || '(see attached files)' },
          ],
          provider:           selectedProvider,
          model:               selectedModel,
          projectSlug:         currentProject?.slug,
          projectTypeId:       currentProject?.typeId,
          enableTools:         !!currentProject,
          projectEnv:          currentProject?.env ?? 'dev',
          designSkillsEnabled,
          replicateEnabled,
          ...(chatAttachments.length > 0 ? { attachments: chatAttachments } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        appendToLast(currentProjectId, `Error: ${err.error ?? 'Unknown error'}`);
        return;
      }

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
            const event = JSON.parse(raw) as {
              type:         string;
              delta?:       string;
              error?:       string;
              name?:        string;
              args?:        string;
              summary?:     string;
              ok?:          boolean;
              id?:          string;
              // Phase events from the orchestrator
              niche?:       string;
              pagesCount?:  number;
              assetsCount?: number;
              voice?:       string;
              palette?:     string;
              filesTouched?: number;
              swaps?:       number;
              findings?:    Array<{ level: string; category: string; page?: string; message: string }>;
            };
            if (event.type === 'delta' && event.delta) {
              appendToLast(currentProjectId, event.delta);
            } else if (event.type === 'tool_start') {
              const hint = formatToolStart(event.name ?? 'tool', event.args ?? '');
              appendToLast(currentProjectId, `\n\n${hint}`);
              const pathHint = extractPath(event.args ?? '');
              if (pathHint && currentProject) {
                useProjectStore.getState().addAffectedFile(currentProject.id, pathHint);
              }
            } else if (event.type === 'tool_result') {
              const icon = event.ok ? '✓' : '✗';
              appendToLast(currentProjectId, `\n  ${icon} ${event.summary ?? ''}`);
            } else if (event.type === 'plan_start') {
              appendToLast(currentProjectId, `\n\n☆ Planning…`);
            } else if (event.type === 'plan_done') {
              const niche = event.niche ?? 'generic';
              appendToLast(currentProjectId, `\n  ✓ Plan ready · niche: **${niche}** · ${event.pagesCount ?? 0} page${event.pagesCount === 1 ? '' : 's'} · ${event.assetsCount ?? 0} image${event.assetsCount === 1 ? '' : 's'} · palette: \`${event.palette ?? '?'}\``);
            } else if (event.type === 'plan_failed') {
              appendToLast(currentProjectId, `\n  ⚠ Planner skipped: ${event.error ?? 'unknown'}. Falling back to legacy build.`);
            } else if (event.type === 'humanize_done') {
              if ((event.swaps ?? 0) > 0) {
                appendToLast(currentProjectId, `\n\n✨ Humanizer: ${event.swaps} AI-tells removed across ${event.filesTouched} file${event.filesTouched === 1 ? '' : 's'}`);
              }
            } else if (event.type === 'polish_done') {
              const findings = event.findings ?? [];
              const fixed = findings.filter((f) => f.level === 'auto-fixed').length;
              const flagged = findings.filter((f) => f.level === 'flag').length;
              if (fixed > 0 || flagged > 0) {
                appendToLast(currentProjectId, `\n\n🔍 Polish: ${fixed} auto-fixed, ${flagged} flag${flagged === 1 ? '' : 's'}`);
                for (const f of findings.filter((f) => f.level === 'flag').slice(0, 5)) {
                  appendToLast(currentProjectId, `\n  ⚠ ${f.category} — ${f.message}${f.page ? ` (${f.page})` : ''}`);
                }
              }
            } else if (event.type === 'error') {
              appendToLast(currentProjectId, `\n\n⚠ ${event.error}`);
              // Clear the active run so the "Run in progress" banner + "Planning…"
              // pill go away when the orchestrator emits a terminal error.
              useRunStore.getState().setActiveRun(null);
            } else if (event.type === 'done') {
              // Server signaled end-of-run cleanly. No UI message (phase events
              // like plan_done / polish_done already covered status). Drop the
              // active run so the banner clears.
              useRunStore.getState().setActiveRun(null);
            }
          } catch { /* malformed SSE line */ }
        }
      }
      // Belt-and-suspenders: the stream closed (reader EOF) without us seeing a
      // 'done' or 'error' event — network drop, server crash mid-stream, etc.
      // Guarantee the banner clears so the user isn't stuck on "Planning…".
      // setActiveRun(null) is idempotent, safe to call after explicit clears.
      if (useRunStore.getState().activeRun) {
        useRunStore.getState().setActiveRun(null);
      }
    } catch (err) {
      appendToLast(
        currentProjectId,
        `\n\nNetwork error: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Same reason as the post-loop cleanup above — network errors should not
      // leave the run banner stranded in 'running' / 'planning'.
      useRunStore.getState().setActiveRun(null);
    }
  }

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

  const isRunning    = sending || activeRun?.status === 'running' || activeRun?.status === 'planning';
  const projectLabel = currentProject ? currentProject.name : 'No project';
  const hasLogo      = attachments.some((a) => a.isLogo);
  const canSend      = (draft.trim().length > 0 || attachments.length > 0) && !isRunning;

  return (
    <div className="abw-chat" aria-label="Chat thread">
      {/* Project context chip */}
      <div
        style={{
          padding: '0 var(--space-3) var(--space-2)',
          fontSize: '0.6875rem',
          color: 'var(--text-tertiary)',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
        }}
        title={`Memory bank: ${currentProject?.id ?? 'global'}`}
      >
        <span aria-hidden>🧠</span>
        <span>{projectLabel}</span>
        {currentProject && (
          <span style={{ color: 'var(--accent-500)', marginLeft: 'auto' }}>
            {currentProject.memory.completedTasks.length > 0
              ? `${currentProject.memory.completedTasks.length} tasks done`
              : 'Fresh start'}
          </span>
        )}
      </div>

      {/* Active run banner */}
      {isRunning && (
        <div className="abw-chat__run-banner" role="status" aria-live="polite">
          <span className="abw-chat__run-dot" aria-hidden />
          Run in progress
        </div>
      )}

      {/* Message list — markdown-rendered */}
      <div className="abw-chat__messages" role="log" aria-live="polite" aria-label="Messages">
        {messages.length === 0 && (
          <div style={{
            color: 'var(--text-secondary)', fontSize: '0.8125rem',
            textAlign: 'center', padding: 'var(--space-4) 0',
          }}>
            <div style={{ fontSize: '1.5rem', opacity: 0.3, marginBottom: 'var(--space-2)' }}>💬</div>
            <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
              No messages yet
            </div>
            <div>Describe what you want to build.</div>
          </div>
        )}
        {messages.filter((msg) => {
          // Suppress internal sanitizer errors the model occasionally echoes
          // back as a chat reply (the user saw "arguments were not valid JSON
          // — model should retry with smaller content" in their panel; that
          // string lived in the model's tool_call args after a truncation
          // event and the model parroted it on its next turn). Server-side
          // fixes in round 16.2 stop new errors from looking like English
          // text, but old persisted messages can still contain the legacy
          // phrasing — this filter masks them at render time.
          if (msg.role !== 'assistant') return true;
          const c = (msg.content ?? '').trim();
          if (!c) return true;
          const STUB_ERROR_PATTERNS: RegExp[] = [
            /^arguments were not valid JSON/i,
            /^Error:?\s*tool arguments were not valid JSON/i,
            /^arguments truncated\s*[—-]\s*content was too large/i,
            /^\[internal:retry\]/i,
          ];
          return !STUB_ERROR_PATTERNS.some((p) => p.test(c));
        }).map((msg, idx, visibleArr) => {
          const isLastAssistant = msg.role === 'assistant' && idx === visibleArr.length - 1 && isRunning;
          return (
            <div key={msg.id} className={`abw-chat__msg abw-chat__msg--${msg.role}`}>
              <div className="abw-chat__bubble">
                {msg.content === '' && isLastAssistant ? (
                  <span className="abw-chat__typing" aria-label="Assistant is thinking">
                    <span /><span /><span />
                  </span>
                ) : (
                  <MarkdownContent content={msg.content} streaming={isLastAssistant} />
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} aria-hidden />
      </div>

      {/* Inline approvals dock — auto-renders only when something is pending
          (or just decided in the last 30s). Sits between message list and
          composer so review actions feel like part of the conversation. */}
      <ApprovalsQueue />

      {/* ── Attachment preview row ── */}
      {attachments.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          borderTop: '1px solid var(--border-base)',
        }}>
          {hasLogo && (
            <div style={{
              width: '100%', fontSize: '0.6875rem', color: 'var(--accent-600)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              🎨 Logo detected — color scheme will adapt to match
            </div>
          )}
          {attachments.map((att, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-base)',
                borderRadius: 'var(--radius-field)',
                padding: '3px 6px',
                fontSize: '0.6875rem',
                maxWidth: 160,
              }}
            >
              {att.isImage && att.previewUrl ? (
                <img
                  src={att.previewUrl}
                  alt={att.file.name}
                  style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }}
                />
              ) : (
                <span style={{ fontSize: '1rem' }} aria-hidden>📄</span>
              )}
              <span
                style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: 'var(--text-primary)', flex: 1,
                }}
                title={att.file.name}
              >
                {att.file.name}
              </span>
              {att.isLogo && (
                <span title="Logo detected" style={{ fontSize: '0.75rem' }}>🎨</span>
              )}
              <button
                onClick={() => removeAttachment(idx)}
                aria-label={`Remove ${att.file.name}`}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', padding: 0, fontSize: '0.75rem',
                  lineHeight: 1, flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Capability toggles ── */}
      <div
        className="abw-chat__toggles"
        role="group"
        aria-label="Capabilities"
        style={{
          display: 'flex', gap: 'var(--space-3)',
          padding: 'var(--space-1) var(--space-3) 0',
          alignItems: 'center', flexWrap: 'wrap',
        }}
      >
        <Toggle
          size="sm"
          checked={designSkillsEnabled}
          onChange={setDesignSkillsEnabled}
          ariaLabel="Toggle Huashu design skills"
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span aria-hidden style={{ fontSize: '0.75rem', opacity: designSkillsEnabled ? 1 : 0.55 }}>✦</span>
              <span style={{ fontSize: '0.75rem', color: designSkillsEnabled ? 'var(--accent-600)' : 'var(--text-secondary)' }}>
                Design
              </span>
            </span>
          }
        />
        <Toggle
          size="sm"
          checked={replicateEnabled}
          onChange={setReplicateEnabled}
          ariaLabel="Toggle Replicate video generation"
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span aria-hidden style={{ fontSize: '0.75rem', opacity: replicateEnabled ? 1 : 0.55 }}>🎥</span>
              <span style={{ fontSize: '0.75rem', color: replicateEnabled ? 'var(--accent-600)' : 'var(--text-secondary)' }}>
                Replicate
              </span>
            </span>
          }
        />
        {(designSkillsEnabled || replicateEnabled) && (
          <span
            style={{ fontSize: '0.625rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}
            title="Enabled capabilities consume credits or run extra tooling"
          >
            {replicateEnabled ? '⚡ uses credits' : ''}
          </span>
        )}
      </div>

      {/* Status pill — model + agent status + autonomy controls in 32px */}
      <StatusPill />

      {/* Inline input row */}
      <form className="abw-chat__input-row" onSubmit={onSubmit} aria-label="Send message">
        {/* Hidden file input — Local tab triggers it programmatically */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,application/pdf,.txt,.md,.csv,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            void handleFiles(e.target.files);
            setPickerOpen(false);
          }}
          aria-hidden
        />

        {/* Paperclip + popover wrapper (relative for absolute popover positioning) */}
        <div ref={pickerWrapRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            aria-label="Attach file"
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            title="Attach — local file or pick from library"
            disabled={isRunning || attachments.length >= 5}
            onClick={() => setPickerOpen((v) => !v)}
            style={{
              background: 'none', border: 'none',
              cursor: isRunning || attachments.length >= 5 ? 'default' : 'pointer',
              color: attachments.length > 0 ? 'var(--accent-500)' : 'var(--text-tertiary)',
              opacity: isRunning || attachments.length >= 5 ? 0.4 : 1,
              padding: '0 var(--space-1)', fontSize: '1rem', lineHeight: 1,
              transition: 'color var(--duration-fast) var(--ease-standard)',
            }}
          >
            📎
          </button>

          {pickerOpen && (
            <div
              role="dialog"
              aria-label="Attach media"
              style={{
                position:     'absolute',
                bottom:       'calc(100% + 4px)',
                left:         0,
                width:        420,
                background:   'var(--surface-base)',
                border:       '1px solid var(--border-base)',
                borderRadius: 'var(--radius-card)',
                boxShadow:    'var(--shadow-overlay)',
                zIndex:       40,
                overflow:     'hidden',
              }}
            >
              {/* Tab bar */}
              <div style={{
                display: 'flex', borderBottom: '1px solid var(--border-base)',
              }} role="tablist">
                {(['local', 'library'] as const).map((tab) => {
                  const active = pickerTab === tab;
                  return (
                    <button
                      key={tab}
                      role="tab"
                      type="button"
                      aria-selected={active}
                      onClick={() => setPickerTab(tab)}
                      style={{
                        flex: 1,
                        padding: 'var(--space-2)',
                        background: active ? 'var(--surface-base)' : 'var(--bg-subtle)',
                        border: 'none',
                        borderBottom: active ? '2px solid var(--accent-500)' : '2px solid transparent',
                        color: active ? 'var(--accent-600)' : 'var(--text-secondary)',
                        cursor: 'pointer', fontWeight: active ? 600 : 500,
                        fontSize: '0.75rem',
                        textTransform: 'capitalize',
                      }}
                    >
                      {tab === 'local' ? 'Local file' : 'Library'}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  aria-label="Close attach panel"
                  style={{
                    background: 'none', border: 'none', padding: '0 var(--space-2)',
                    cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: '0.875rem',
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Tab body */}
              {pickerTab === 'local' ? (
                <LocalUploadTab
                  onPick={() => fileInputRef.current?.click()}
                  onFiles={(files) => {
                    void handleFiles(files);
                    setPickerOpen(false);
                  }}
                />
              ) : (
                <div style={{ padding: 'var(--space-2)' }}>
                  <PlatformMediaPicker onPick={addLibraryAsset} />
                </div>
              )}
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          className="abw-chat__input"
          value={expanded ? '' : draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            sending    ? 'Thinking…' :
            isRunning  ? 'Run in progress…' :
            attachments.length > 0 ? 'Add a message… (optional)' :
            'Describe what to build… (Enter to send, ⌘E to expand)'
          }
          rows={1}
          aria-label="Message input"
          disabled={isRunning || expanded}
          style={expanded ? { opacity: 0.4 } : undefined}
        />

        {/* Expand */}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Expand chat composer"
          title="Expand (⌘E)"
          disabled={isRunning}
          style={{
            background: 'none', border: 'none',
            cursor: isRunning ? 'default' : 'pointer',
            color: 'var(--text-tertiary)', opacity: isRunning ? 0.4 : 1,
            padding: '0 var(--space-1)', fontSize: '0.875rem', lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ⤢
        </button>

        <button
          type="submit"
          disabled={!canSend}
          style={{
            height: 36, padding: '0 var(--space-3)',
            border: 'none', borderRadius: 'var(--radius-button)',
            background: 'var(--accent-500)', color: '#fff',
            cursor: canSend ? 'pointer' : 'default',
            opacity: canSend ? 1 : 0.4,
            fontWeight: 600, fontSize: '0.8125rem', flexShrink: 0,
            transition: 'opacity var(--duration-fast) var(--ease-standard)',
          }}
          aria-label="Send"
        >
          Send
        </button>
      </form>

      {/* ── Expanded composer overlay ── */}
      {expanded && (
        <div className="abw-chat__expanded" role="dialog" aria-label="Expanded composer" aria-modal>
          <div className="abw-chat__expanded-header">
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Compose · {projectLabel}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>
              ⌘E or Esc to close · Enter sends · Shift+Enter newline
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Close expanded composer"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-secondary)', fontSize: '1rem', padding: '0 var(--space-2)',
              }}
            >
              ✕
            </button>
          </div>

          <textarea
            ref={expandedTextareaRef}
            className="abw-chat__expanded-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe what to build in detail…"
            disabled={isRunning}
            aria-label="Expanded message input"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />

          <div className="abw-chat__expanded-footer">
            <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>
              {draft.length} characters
            </span>
            <button
              type="button"
              className="abw-btn abw-btn--ghost abw-btn--sm"
              onClick={() => setExpanded(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="abw-btn abw-btn--primary abw-btn--sm"
              disabled={!canSend}
              onClick={() => {
                if (!sending) { setSending(true); void submit().finally(() => setSending(false)); }
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
