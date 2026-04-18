// packages/agent-core/memory.ts — RunMemory serialization and mutation helpers.
// The memory object lives in `agent_runs.memory` (jsonb). It is the agent's
// persistent working context across steps, resumptions, and compaction cycles.
import type { RunMemory, Decision, KnownBug, Blocker, VerificationResult, Screenshot } from './types';

export const EMPTY_MEMORY: RunMemory = {
  goal:              '',
  constraints:       [],
  model:             '',
  provider:          '',
  affectedFiles:     [],
  decisions:         [],
  completedSubtasks: [],
  remainingSubtasks: [],
  knownBugs:         [],
  blockers:          [],
  verification:      [],
  screenshots:       [],
  nextActions:       [],
};

/** Deserialize from DB jsonb (handles null / missing fields gracefully). */
export function deserializeMemory(raw: unknown): RunMemory {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_MEMORY };
  const r = raw as Partial<RunMemory>;
  return {
    goal:              r.goal              ?? '',
    constraints:       r.constraints       ?? [],
    model:             r.model             ?? '',
    provider:          r.provider          ?? '',
    affectedFiles:     r.affectedFiles     ?? [],
    decisions:         r.decisions         ?? [],
    completedSubtasks: r.completedSubtasks ?? [],
    remainingSubtasks: r.remainingSubtasks ?? [],
    knownBugs:         r.knownBugs         ?? [],
    blockers:          r.blockers          ?? [],
    verification:      r.verification      ?? [],
    screenshots:       r.screenshots       ?? [],
    nextActions:       r.nextActions       ?? [],
  };
}

/** Serialize to a plain object suitable for JSON storage. */
export function serializeMemory(mem: RunMemory): Record<string, unknown> {
  return mem as unknown as Record<string, unknown>;
}

// ── Mutation helpers ──────────────────────────────────────────────────────────

export function markSubtaskComplete(mem: RunMemory, subtask: string): RunMemory {
  return {
    ...mem,
    completedSubtasks: [...mem.completedSubtasks, subtask],
    remainingSubtasks: mem.remainingSubtasks.filter((s) => s !== subtask),
  };
}

export function addDecision(mem: RunMemory, decision: Omit<Decision, 'at'>): RunMemory {
  return {
    ...mem,
    decisions: [...mem.decisions, { ...decision, at: new Date().toISOString() }],
  };
}

export function addBug(mem: RunMemory, bug: Omit<KnownBug, 'id'>): RunMemory {
  const id = crypto.randomUUID();
  return { ...mem, knownBugs: [...mem.knownBugs, { id, ...bug }] };
}

export function markBugFixed(mem: RunMemory, bugId: string): RunMemory {
  return {
    ...mem,
    knownBugs: mem.knownBugs.map((b) =>
      b.id === bugId ? { ...b, fixedAt: new Date().toISOString() } : b,
    ),
  };
}

export function addBlocker(mem: RunMemory, reason: string): RunMemory {
  const id = crypto.randomUUID();
  return {
    ...mem,
    blockers: [...mem.blockers, { id, reason, at: new Date().toISOString(), resolved: false }],
  };
}

export function resolveBlocker(mem: RunMemory, blockerId: string): RunMemory {
  return {
    ...mem,
    blockers: mem.blockers.map((b) => b.id === blockerId ? { ...b, resolved: true } : b),
  };
}

export function updateVerification(mem: RunMemory, result: VerificationResult): RunMemory {
  const existing = mem.verification.findIndex((v) => v.adapter === result.adapter);
  const next = [...mem.verification];
  if (existing >= 0) next[existing] = result;
  else next.push(result);
  return { ...mem, verification: next };
}

export function addScreenshot(mem: RunMemory, screenshot: Screenshot): RunMemory {
  // Replace if same route + viewport already captured
  const existing = mem.screenshots.findIndex(
    (s) => s.route === screenshot.route && s.viewport === screenshot.viewport,
  );
  const next = [...mem.screenshots];
  if (existing >= 0) next[existing] = screenshot;
  else next.push(screenshot);
  return { ...mem, screenshots: next };
}

export function setNextActions(mem: RunMemory, actions: string[]): RunMemory {
  return { ...mem, nextActions: actions };
}

/** Estimated byte size of serialized memory (for compaction threshold). */
export function memoryByteSize(mem: RunMemory): number {
  return JSON.stringify(mem).length;
}

export const COMPACTION_THRESHOLD_BYTES = 8_000;
