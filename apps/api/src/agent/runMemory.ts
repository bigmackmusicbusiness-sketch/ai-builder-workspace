// apps/api/src/agent/runMemory.ts — persist and reload RunMemory from agent_runs.memory.
// Memory is stored as jsonb on the run record and updated after every step.
import { getDb } from '../db/client';
import { agentRuns } from '@abw/db';
import { eq, and } from 'drizzle-orm';
import {
  type RunMemory,
  deserializeMemory,
  serializeMemory,
  maybeCompact,
} from '@abw/agent-core';

/** Load memory for a run. Returns EMPTY_MEMORY if not found. */
export async function loadMemory(runId: string, tenantId: string): Promise<RunMemory> {
  const db = getDb();
  const [row] = await db
    .select({ memory: agentRuns.memory })
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId)))
    .limit(1);
  return deserializeMemory(row?.memory);
}

/** Save memory (with compaction if needed). Returns the (possibly compacted) memory. */
export async function saveMemory(
  runId: string,
  tenantId: string,
  memory: RunMemory,
): Promise<RunMemory> {
  const { memory: compacted } = maybeCompact(memory);
  const db = getDb();
  await db
    .update(agentRuns)
    .set({ memory: serializeMemory(compacted) })
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId)));
  return compacted;
}

/** Patch specific memory fields without reloading the full object. */
export async function patchMemory(
  runId: string,
  tenantId: string,
  patch: Partial<RunMemory>,
): Promise<RunMemory> {
  const current = await loadMemory(runId, tenantId);
  const updated = { ...current, ...patch };
  return saveMemory(runId, tenantId, updated);
}
