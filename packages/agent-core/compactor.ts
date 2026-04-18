// packages/agent-core/compactor.ts — memory compaction.
// When the RunMemory exceeds COMPACTION_THRESHOLD_BYTES, this rewrites narrative
// noise (long decision text, completed subtask details) while preserving every
// structural key. The result must still be a valid RunMemory.
import type { RunMemory, Decision } from './types';
import { memoryByteSize, COMPACTION_THRESHOLD_BYTES, serializeMemory } from './memory';

export interface CompactionResult {
  compacted: boolean;
  beforeBytes: number;
  afterBytes: number;
  memory: RunMemory;
}

/**
 * Compact memory if it exceeds the threshold.
 * Always safe to call — returns original if no compaction needed.
 */
export function maybeCompact(mem: RunMemory): CompactionResult {
  const beforeBytes = memoryByteSize(mem);
  if (beforeBytes < COMPACTION_THRESHOLD_BYTES) {
    return { compacted: false, beforeBytes, afterBytes: beforeBytes, memory: mem };
  }
  const compacted = compact(mem);
  const afterBytes = memoryByteSize(compacted);
  return { compacted: true, beforeBytes, afterBytes, memory: compacted };
}

function compact(mem: RunMemory): RunMemory {
  return {
    ...mem,
    // Shorten completed subtask list to last 10 (already-done; history not needed in full)
    completedSubtasks: compactStringList(mem.completedSubtasks, 10),
    // Shorten decision text — keep reason concise
    decisions: compactDecisions(mem.decisions, 20),
    // Drop fixed bugs beyond the last 5
    knownBugs: [
      ...mem.knownBugs.filter((b) => !b.fixedAt),
      ...mem.knownBugs.filter((b) => b.fixedAt).slice(-5),
    ],
    // Keep only unresolved blockers + last 3 resolved
    blockers: [
      ...mem.blockers.filter((b) => !b.resolved),
      ...mem.blockers.filter((b) => b.resolved).slice(-3),
    ],
    // Verification: keep all (small, important)
    // Screenshots: keep most recent per route+viewport (already de-duped in addScreenshot)
    screenshots: mem.screenshots.slice(-20),
    // Next actions: keep as-is (small)
  };
}

function compactStringList(list: string[], keep: number): string[] {
  if (list.length <= keep) return list;
  const dropped = list.length - keep;
  return [`[… ${dropped} earlier items omitted …]`, ...list.slice(-keep)];
}

function compactDecisions(decisions: Decision[], keep: number): Decision[] {
  if (decisions.length <= keep) return decisions;
  const dropped = decisions.length - keep;
  const summary: Decision = {
    at:     decisions[0]?.at ?? new Date().toISOString(),
    reason: `[${dropped} earlier decisions compacted]`,
    choice: 'see run_id for full history',
  };
  return [summary, ...decisions.slice(-keep)];
}

/**
 * Force a full compaction regardless of size (used before writing a summary).
 */
export function forceCompact(mem: RunMemory): RunMemory {
  return compact(mem);
}

/** Serialize compacted memory for DB storage. */
export { serializeMemory };
