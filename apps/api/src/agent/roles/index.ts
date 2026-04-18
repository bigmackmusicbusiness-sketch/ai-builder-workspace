// apps/api/src/agent/roles/index.ts — role definitions and tool permission matrix.
// Each role specifies which tools it may call. The orchestrator enforces this.
import type { AgentRole, ToolDef } from '@abw/agent-core';

export interface RoleDef {
  id:          AgentRole;
  label:       string;
  description: string;
  allowedTools: string[];
}

export const ROLES: Record<AgentRole, RoleDef> = {
  planner: {
    id:          'planner',
    label:       'Planner',
    description: 'Analyses the goal, identifies affected files, produces a subtask plan.',
    allowedTools: ['fs.read', 'db.query', 'verify.run'],
  },
  builder: {
    id:          'builder',
    label:       'Builder',
    description: 'Implements changes scoped to the plan\'s affectedFiles.',
    allowedTools: ['fs.read', 'fs.write', 'fs.diff', 'shell.exec'],
  },
  runtime: {
    id:          'runtime',
    label:       'Runtime',
    description: 'Boots preview and runs lint/typecheck/build/unit verification.',
    allowedTools: ['preview.boot', 'verify.run'],
  },
  visual: {
    id:          'visual',
    label:       'Visual',
    description: 'Captures screenshots and runs Playwright + screenshotDiff.',
    allowedTools: ['preview.screenshot', 'verify.run'],
  },
  backend: {
    id:          'backend',
    label:       'Backend',
    description: 'Applies dev migrations, runs integration/e2e checks, invokes integrations.',
    allowedTools: ['db.migrate', 'db.query', 'verify.run', 'integration.invoke'],
  },
  fixer: {
    id:          'fixer',
    label:       'Fixer',
    description: 'Fixes specific findings. Each fs.write must reference a finding ID.',
    allowedTools: ['fs.read', 'fs.write', 'fs.diff', 'shell.exec'],
  },
  release: {
    id:          'release',
    label:       'Release',
    description: 'Read-only across all; assembles approval bundles for production actions.',
    allowedTools: ['fs.read', 'db.query', 'verify.run'],
  },
};

/** Check whether a role may call a given tool. */
export function isToolAllowed(role: AgentRole, tool: string): boolean {
  return ROLES[role]?.allowedTools.includes(tool) ?? false;
}

/** Assert a role may call a tool; throws if not permitted. */
export function assertToolAllowed(role: AgentRole, tool: string): void {
  if (!isToolAllowed(role, tool)) {
    throw Object.assign(
      new Error(`Role '${role}' is not permitted to call tool '${tool}'.`),
      { code: 'TOOL_NOT_ALLOWED' },
    );
  }
}
