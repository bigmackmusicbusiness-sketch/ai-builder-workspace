// packages/agent-core/budget.ts — run budget guards.
// Called by the orchestrator before each step to enforce limits.
import type { RunBudget } from './types';

export type BudgetViolation =
  | { kind: 'steps';   used: number; max: number }
  | { kind: 'time';    usedMs: number; maxMs: number }
  | { kind: 'cost';    usedUsd: number; maxUsd: number };

/**
 * Check whether the budget allows another step.
 * Returns null if OK, or a BudgetViolation describing why not.
 */
export function checkBudget(budget: RunBudget): BudgetViolation | null {
  if (budget.usedSteps >= budget.maxSteps) {
    return { kind: 'steps', used: budget.usedSteps, max: budget.maxSteps };
  }
  if (budget.usedTimeMs >= budget.maxTimeMs) {
    return { kind: 'time', usedMs: budget.usedTimeMs, maxMs: budget.maxTimeMs };
  }
  if (budget.usedCostUsd >= budget.maxCostUsd) {
    return { kind: 'cost', usedUsd: budget.usedCostUsd, maxUsd: budget.maxCostUsd };
  }
  return null;
}

/** Increment step count and elapsed time. Returns updated budget. */
export function consumeStep(budget: RunBudget, durationMs: number, costUsd = 0): RunBudget {
  return {
    ...budget,
    usedSteps:   budget.usedSteps + 1,
    usedTimeMs:  budget.usedTimeMs + durationMs,
    usedCostUsd: budget.usedCostUsd + costUsd,
  };
}

/** Human-readable budget summary for run summaries and logs. */
export function budgetSummary(budget: RunBudget): string {
  const pct = (used: number, max: number) => `${used}/${max} (${Math.round((used / max) * 100)}%)`;
  return [
    `steps: ${pct(budget.usedSteps, budget.maxSteps)}`,
    `time: ${Math.round(budget.usedTimeMs / 1000)}s / ${Math.round(budget.maxTimeMs / 1000)}s`,
    `cost: $${budget.usedCostUsd.toFixed(4)} / $${budget.maxCostUsd.toFixed(2)}`,
  ].join(' · ');
}

/** Format a BudgetViolation into a human-readable stop reason. */
export function formatViolation(v: BudgetViolation): string {
  switch (v.kind) {
    case 'steps': return `Step limit reached (${v.used}/${v.max} steps used).`;
    case 'time':  return `Time limit reached (${Math.round(v.usedMs / 1000)}s / ${Math.round(v.maxMs / 1000)}s).`;
    case 'cost':  return `Cost limit reached ($${v.usedUsd.toFixed(4)} / $${v.maxUsd.toFixed(2)}).`;
  }
}
