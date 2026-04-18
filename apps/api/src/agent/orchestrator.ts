// apps/api/src/agent/orchestrator.ts — agent orchestration loop.
//
// Loop: plan → identify affected files → small edit → run → inspect → fix → re-verify → summarize
//
// A run is "complete" only when the verification matrix is green (or each
// non-green item is explicitly skipped with a reason). Completion ≠ code written.
//
// Autonomy controls: Pause / Resume / Stop / Emergency Kill via `control`.
// Budget: enforced before every step (max-steps / max-time / max-cost).
// Restore point: auto-created before every run via filesRepo.createSnapshot.

import { createHash } from 'node:crypto';
import { getDb } from '../db/client';
import { agentRuns, agentSteps } from '@abw/db';
import { eq, and } from 'drizzle-orm';
import {
  type RunMemory, type AgentRole, type RunBudget,
  DEFAULT_BUDGET, checkBudget, consumeStep, formatViolation,
  EMPTY_MEMORY, serializeMemory, maybeCompact,
  addDecision, markSubtaskComplete,
} from '@abw/agent-core';
import { loadMemory, saveMemory } from './runMemory';
import { createSnapshot } from '../db/repositories/filesRepo';
import { writeAuditEvent } from '../security/audit';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  runId:       string;
  tenantId:    string;
  projectId:   string;
  userId:      string;
  goal:        string;
  provider:    string;
  model:       string;
  projectRoot: string;
  budget?:     Partial<RunBudget>;
}

export interface ControlSignal {
  paused:  boolean;
  stopped: boolean;
  killed:  boolean;
}

export type StreamEvent =
  | { type: 'step_started';   stepId: string; role: AgentRole; tool: string }
  | { type: 'step_done';      stepId: string; ok: boolean; durationMs: number }
  | { type: 'memory_updated'; fields: Partial<RunMemory> }
  | { type: 'log';            level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'paused';         reason: string }
  | { type: 'completed';      summary: string }
  | { type: 'failed';         error: string };

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class Orchestrator {
  private runId:       string;
  private tenantId:    string;
  private projectId:   string;
  private userId:      string;
  private goal:        string;
  private provider:    string;
  private model:       string;
  private projectRoot: string;
  private budget:      RunBudget;
  private control:     ControlSignal = { paused: false, stopped: false, killed: false };
  private emit:        (event: StreamEvent) => void;

  constructor(opts: OrchestratorOptions, emit: (event: StreamEvent) => void) {
    this.runId       = opts.runId;
    this.tenantId    = opts.tenantId;
    this.projectId   = opts.projectId;
    this.userId      = opts.userId;
    this.goal        = opts.goal;
    this.provider    = opts.provider;
    this.model       = opts.model;
    this.projectRoot = opts.projectRoot;
    this.budget      = { ...DEFAULT_BUDGET, ...opts.budget };
    this.emit        = emit;
  }

  pause()  { this.control.paused  = true;  }
  resume() { this.control.paused  = false; }
  stop()   { this.control.stopped = true;  }
  kill()   { this.control.killed  = true; this.control.stopped = true; }

  // ── Main loop ───────────────────────────────────────────────────────────────

  async run(): Promise<void> {
    const db = getDb();

    await db.update(agentRuns)
      .set({ status: 'running', startedAt: new Date() })
      .where(and(eq(agentRuns.id, this.runId), eq(agentRuns.tenantId, this.tenantId)));

    // Auto-snapshot restore point before autonomous run
    try {
      await createSnapshot(this.projectId, this.tenantId, this.userId, 'auto:pre-run');
      this.emit({ type: 'log', level: 'info', message: 'Restore point created before run.' });
    } catch {
      this.emit({ type: 'log', level: 'warn', message: 'Could not create restore point (no files yet?).' });
    }

    try {
      // Phase 1: Plan
      this.emit({ type: 'log', level: 'info', message: `Starting run: ${this.goal}` });
      const memory = await this.planPhase();
      await saveMemory(this.runId, this.tenantId, memory);

      if (this.control.stopped) {
        await this.finish('killed', memory, 'Stopped by user before execution.');
        return;
      }

      // Phase 2: Execute subtasks
      let currentMemory = memory;
      for (const subtask of [...currentMemory.remainingSubtasks]) {
        if (this.control.killed) break;

        while (this.control.paused && !this.control.stopped) {
          await sleep(500);
        }
        if (this.control.stopped) break;

        const violation = checkBudget(this.budget);
        if (violation) {
          await this.finish('failed', currentMemory, formatViolation(violation));
          return;
        }

        currentMemory = await this.executeSubtask(subtask, currentMemory);
        currentMemory = markSubtaskComplete(currentMemory, subtask);
        await saveMemory(this.runId, this.tenantId, currentMemory);
      }

      // Phase 3: Summarize
      const allGreen = currentMemory.verification.every((v) => v.ok || v.skipped);
      if (!allGreen && !this.control.stopped) {
        this.emit({ type: 'log', level: 'warn', message: 'Some verification checks did not pass.' });
      }

      await this.finish(
        this.control.stopped ? 'killed' : 'completed',
        currentMemory,
        this.buildSummary(currentMemory),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'failed', error: message });
      await db.update(agentRuns)
        .set({ status: 'failed', endedAt: new Date(), summary: `Failed: ${message}` })
        .where(eq(agentRuns.id, this.runId));
    }
  }

  // ── Plan phase ──────────────────────────────────────────────────────────────

  private async planPhase(): Promise<RunMemory> {
    const stepId = await this.startStep('planner', 'planning');
    const start  = Date.now();

    // Real impl: call provider with planning prompt.
    // Stub: derive one subtask from the goal.
    const subtasks = [`Implement: ${this.goal}`];
    const affectedFiles: string[] = ['src/index.ts'];
    if (this.goal.toLowerCase().includes('page'))   affectedFiles.push('src/pages/index.tsx');
    if (this.goal.toLowerCase().includes('api'))    affectedFiles.push('src/api/routes.ts');
    if (this.goal.toLowerCase().includes('pricing')) affectedFiles.push('src/pages/pricing.tsx');

    const memory: RunMemory = {
      ...EMPTY_MEMORY,
      goal:              this.goal,
      model:             this.model,
      provider:          this.provider,
      affectedFiles,
      remainingSubtasks: subtasks,
      nextActions:       [`Build: ${subtasks[0]}`],
      constraints:       ['Scope writes to affectedFiles', 'No secrets in code'],
    };

    await this.completeStep(stepId, { subtasks, affectedFiles }, Date.now() - start);
    this.emit({ type: 'memory_updated', fields: { affectedFiles, remainingSubtasks: subtasks } });
    return memory;
  }

  // ── Subtask execution ────────────────────────────────────────────────────────

  private async executeSubtask(subtask: string, memory: RunMemory): Promise<RunMemory> {
    this.emit({ type: 'log', level: 'info', message: `Subtask: ${subtask}` });
    let updated = await this.builderStep(subtask, memory);
    updated = await this.runtimeStep(updated);
    return updated;
  }

  private async builderStep(subtask: string, memory: RunMemory): Promise<RunMemory> {
    const stepId = await this.startStep('builder', 'fs.write');
    const start  = Date.now();

    const updated = addDecision(memory, {
      reason: `Building subtask: ${subtask}`,
      choice: 'Stub implementation — real model call wired in provider integration step',
    });

    await this.completeStep(stepId, { subtask, status: 'stub' }, Date.now() - start);
    this.budget = consumeStep(this.budget, Date.now() - start);
    return updated;
  }

  private async runtimeStep(memory: RunMemory): Promise<RunMemory> {
    const stepId = await this.startStep('runtime', 'verify.run');
    const start  = Date.now();

    const result = {
      adapter:    'typecheck' as const,
      ok:          true,
      durationMs:  0,
      summary:    'Skipped — Step 10 wires real pipeline',
      findings:   [],
      skipped:     true,
      skipReason: 'Step 10 not yet wired',
    };

    const updated: RunMemory = {
      ...memory,
      verification: [...memory.verification.filter((v) => v.adapter !== 'typecheck'), result],
    };

    await this.completeStep(stepId, { result }, Date.now() - start);
    this.budget = consumeStep(this.budget, Date.now() - start);
    return updated;
  }

  // ── Step helpers ────────────────────────────────────────────────────────────

  private async startStep(role: AgentRole, tool: string): Promise<string> {
    const stepId = crypto.randomUUID();
    const db = getDb();
    await db.insert(agentSteps).values({
      id:        stepId,
      runId:     this.runId,
      tenantId:  this.tenantId,
      role,
      tool,
      inputHash: createHash('sha256').update(JSON.stringify({ role, tool, ts: Date.now() })).digest('hex'),
      model:     this.model,
      status:    'running',
    });
    this.emit({ type: 'step_started', stepId, role, tool });
    return stepId;
  }

  private async completeStep(stepId: string, output: Record<string, unknown>, durationMs: number): Promise<void> {
    const db = getDb();
    const outputHash = createHash('sha256').update(JSON.stringify(output)).digest('hex');
    await db.update(agentSteps)
      .set({ status: 'completed', outputHash, durationMs })
      .where(eq(agentSteps.id, stepId));
    this.emit({ type: 'step_done', stepId, ok: true, durationMs });
  }

  // ── Finish ──────────────────────────────────────────────────────────────────

  private async finish(
    status: 'completed' | 'failed' | 'killed',
    memory: RunMemory,
    summary: string,
  ): Promise<void> {
    const db = getDb();
    await db.update(agentRuns)
      .set({ status, endedAt: new Date(), summary, memory: serializeMemory(memory) })
      .where(eq(agentRuns.id, this.runId));

    await writeAuditEvent({
      actor:    this.userId,
      tenantId: this.tenantId,
      action:   `agent.run.${status}`,
      target:   'agent_run',
      targetId: this.runId,
      after:    { status, summary },
      runId:    this.runId,
      env:      'dev',
    });

    if (status === 'completed') {
      this.emit({ type: 'completed', summary });
    } else {
      this.emit({ type: 'failed', error: summary });
    }
  }

  private buildSummary(memory: RunMemory): string {
    const completed    = memory.completedSubtasks.length;
    const remaining    = memory.remainingSubtasks.length;
    const filesChanged = memory.affectedFiles.length;
    const verPassed    = memory.verification.filter((v) => v.ok).length;
    const verTotal     = memory.verification.length;
    return [
      `Goal: ${memory.goal}`,
      `Subtasks: ${completed} completed${remaining > 0 ? `, ${remaining} remaining` : ''}`,
      `Files affected: ${filesChanged}`,
      `Verification: ${verPassed}/${verTotal} passed`,
    ].join('\n');
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export async function createRun(
  opts: OrchestratorOptions,
  emit: (event: StreamEvent) => void,
): Promise<{ orchestrator: Orchestrator; runId: string }> {
  const db = getDb();
  const budget = { ...DEFAULT_BUDGET, ...opts.budget };

  const initialMemory: RunMemory = {
    ...EMPTY_MEMORY,
    goal:     opts.goal,
    model:    opts.model,
    provider: opts.provider,
  };

  const [run] = await db.insert(agentRuns).values({
    tenantId:    opts.tenantId,
    projectId:   opts.projectId,
    initiatedBy: opts.userId,
    goal:        opts.goal,
    provider:    opts.provider,
    model:       opts.model,
    status:      'queued',
    memory:      serializeMemory(initialMemory),
    maxSteps:    budget.maxSteps,
    maxTimeSec:  Math.floor(budget.maxTimeMs / 1000),
    maxCostUsd:  budget.maxCostUsd,
  }).returning({ id: agentRuns.id });

  // Update the runId to match what the DB generated
  const actualRunId = run?.id ?? opts.runId;

  const orchestrator = new Orchestrator({ ...opts, runId: actualRunId }, emit);
  return { orchestrator, runId: actualRunId };
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
