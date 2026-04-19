// apps/api/src/preview/sessionManager.ts — in-process preview session registry.
// Tracks active preview sessions: build status, logs, process PIDs.
// Persisted to preview_sessions table; in-memory map for fast log streaming.

export type SessionStatus =
  | 'queued'
  | 'bundling'
  | 'syncing'
  | 'booted'
  | 'error'
  | 'stopped';

export interface ProcessInfo {
  name: string; // 'dev-server' | 'backend' | 'worker'
  pid?: number;
  status: 'running' | 'stopped' | 'error';
  startedAt: number;
  error?: string;
}

export interface PreviewSession {
  sessionId: string;
  projectId: string;
  projectSlug: string;
  tenantId: string;
  status: SessionStatus;
  previewUrl: string;
  processes: ProcessInfo[];
  logs: LogEntry[];
  startedAt: number;
  error?: string;
  /** Bundled assets stored in memory for local-dev serving (no Cloudflare KV needed). */
  assets?: Map<string, Uint8Array>;
}

export interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string; // 'bundler' | 'dev-server' | 'backend' | 'worker'
  message: string;
}

// In-memory session registry (scoped to this process; Realtime pushes to browser)
const sessions = new Map<string, PreviewSession>();

export function createSession(opts: {
  sessionId: string;
  projectId: string;
  projectSlug: string;
  tenantId: string;
  previewUrl: string;
}): PreviewSession {
  const session: PreviewSession = {
    ...opts,
    status: 'queued',
    processes: [],
    logs: [],
    startedAt: Date.now(),
  };
  sessions.set(opts.sessionId, session);
  return session;
}

export function getSession(sessionId: string): PreviewSession | undefined {
  return sessions.get(sessionId);
}

export function listSessions(tenantId: string): PreviewSession[] {
  return Array.from(sessions.values()).filter((s) => s.tenantId === tenantId);
}

export function storeAssets(sessionId: string, assets: Map<string, Uint8Array>): void {
  const s = sessions.get(sessionId);
  if (s) s.assets = assets;
}

export function getAssets(sessionId: string): Map<string, Uint8Array> | undefined {
  return sessions.get(sessionId)?.assets;
}

/** Look up session by project slug (for the serve endpoint). */
export function getSessionBySlug(slug: string): PreviewSession | undefined {
  return Array.from(sessions.values()).find((s) => s.projectSlug === slug && s.status === 'booted');
}

export function updateSession(
  sessionId: string,
  patch: Partial<Pick<PreviewSession, 'status' | 'processes' | 'error'>>,
): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  Object.assign(s, patch);
}

export function appendLog(sessionId: string, entry: Omit<LogEntry, 'ts'>): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  const log: LogEntry = { ...entry, ts: Date.now() };
  s.logs.push(log);
  // Cap log buffer at 2000 entries per session
  if (s.logs.length > 2000) s.logs.splice(0, s.logs.length - 2000);
}

export function getLogs(sessionId: string, afterTs?: number): LogEntry[] {
  const s = sessions.get(sessionId);
  if (!s) return [];
  if (afterTs === undefined) return s.logs;
  return s.logs.filter((l) => l.ts > afterTs);
}

export function stopSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.status = 'stopped';
  for (const p of s.processes) p.status = 'stopped';
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}
