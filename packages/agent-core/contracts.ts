// packages/agent-core/contracts.ts — Zod I/O contracts for every agent tool.
// The orchestrator validates all tool inputs against these schemas before execution.
// Outputs are also validated so the orchestrator can trust their shape.
import { z } from 'zod';

// ── fs.read ───────────────────────────────────────────────────────────────────

export const FsReadInput = z.object({
  path: z.string().min(1),
  /** Optional line range (1-indexed, inclusive) */
  startLine: z.number().int().positive().optional(),
  endLine:   z.number().int().positive().optional(),
});

export const FsReadOutput = z.object({
  path:    z.string(),
  content: z.string(),
  lines:   z.number().int(),
  lang:    z.string().optional(),
});

// ── fs.write ──────────────────────────────────────────────────────────────────

export const FsWriteInput = z.object({
  path:    z.string().min(1),
  content: z.string(),
  /** Must match one of the paths in the plan's affectedFiles. Rejected otherwise. */
  reason:  z.string().min(1),
});

export const FsWriteOutput = z.object({
  path:        z.string(),
  hash:        z.string(),
  bytesWritten: z.number().int(),
});

// ── fs.diff ───────────────────────────────────────────────────────────────────

export const FsDiffInput = z.object({
  path: z.string().min(1),
  /** Unified diff format, or 'HEAD' to diff against last snapshot */
  against: z.enum(['HEAD', 'original']).default('HEAD'),
});

export const FsDiffOutput = z.object({
  path:    z.string(),
  diff:    z.string(),  // unified diff
  added:   z.number().int(),
  removed: z.number().int(),
});

// ── shell.exec ────────────────────────────────────────────────────────────────

export const ShellExecInput = z.object({
  command:    z.string().min(1),
  args:       z.array(z.string()).default([]),
  /** Working directory relative to project root */
  cwd:        z.string().default('.'),
  timeoutMs:  z.number().int().min(1000).max(120_000).default(30_000),
  /** Env vars safe to pass (no secrets) */
  env:        z.record(z.string()).default({}),
});

export const ShellExecOutput = z.object({
  stdout:   z.string(),
  stderr:   z.string(),
  exitCode: z.number().int(),
  durationMs: z.number().int(),
});

// ── preview.boot ──────────────────────────────────────────────────────────────

export const PreviewBootInput = z.object({
  projectId: z.string().uuid(),
  framework: z.enum(['react-vite', 'vanilla', 'static']).default('react-vite'),
});

export const PreviewBootOutput = z.object({
  sessionId:  z.string(),
  previewUrl: z.string().url(),
  status:     z.string(),
});

// ── preview.screenshot ────────────────────────────────────────────────────────

export const PreviewScreenshotInput = z.object({
  sessionId: z.string(),
  route:     z.string().default('/'),
  viewport:  z.number().int().min(320).max(1920).default(1280),
});

export const PreviewScreenshotOutput = z.object({
  screenshotUrl: z.string(),
  route:         z.string(),
  viewport:      z.number().int(),
  capturedAt:    z.string(),
  consoleErrors: z.number().int(),
});

// ── verify.run ────────────────────────────────────────────────────────────────

export const VerifyRunInput = z.object({
  projectId: z.string().uuid(),
  adapters:  z.array(z.enum([
    'lint', 'typecheck', 'build', 'unit', 'integration',
    'e2e', 'secretScan', 'depVuln', 'migrationSmoke',
    'playwrightRuntime', 'screenshotDiff',
  ])),
  /** If true, only return results of previous runs (do not re-execute) */
  readOnly: z.boolean().default(false),
});

export const VerifyRunOutput = z.object({
  results: z.array(z.object({
    adapter:    z.string(),
    ok:         z.boolean(),
    durationMs: z.number().int(),
    summary:    z.string(),
    findingCount: z.number().int(),
    skipped:    z.boolean(),
  })),
  allGreen: z.boolean(),
});

// ── db.migrate ────────────────────────────────────────────────────────────────

export const DbMigrateInput = z.object({
  projectId:   z.string().uuid(),
  migrationId: z.string().uuid(),
  env:         z.enum(['dev']),  // only dev allowed without approval; others blocked at tool level
});

export const DbMigrateOutput = z.object({
  ok:         z.boolean(),
  appliedAt:  z.string(),
  durationMs: z.number().int(),
});

// ── db.query ──────────────────────────────────────────────────────────────────

export const DbQueryInput = z.object({
  projectId: z.string().uuid(),
  sql:       z.string().min(1),
  params:    z.array(z.unknown()).default([]),
  /** If true, only SELECT statements are allowed */
  readOnly:  z.boolean().default(true),
});

export const DbQueryOutput = z.object({
  rows:       z.array(z.record(z.unknown())),
  rowCount:   z.number().int(),
  durationMs: z.number().int(),
});

// ── integration.invoke ────────────────────────────────────────────────────────

export const IntegrationInvokeInput = z.object({
  integrationId: z.string().uuid(),
  action:        z.string().min(1),
  params:        z.record(z.unknown()).default({}),
});

export const IntegrationInvokeOutput = z.object({
  ok:     z.boolean(),
  result: z.record(z.unknown()),
  durationMs: z.number().int(),
});

// ── Tool contract map ─────────────────────────────────────────────────────────

export const TOOL_CONTRACTS = {
  'fs.read':              { input: FsReadInput,              output: FsReadOutput              },
  'fs.write':             { input: FsWriteInput,             output: FsWriteOutput             },
  'fs.diff':              { input: FsDiffInput,              output: FsDiffOutput              },
  'shell.exec':           { input: ShellExecInput,           output: ShellExecOutput           },
  'preview.boot':         { input: PreviewBootInput,         output: PreviewBootOutput         },
  'preview.screenshot':   { input: PreviewScreenshotInput,   output: PreviewScreenshotOutput   },
  'verify.run':           { input: VerifyRunInput,           output: VerifyRunOutput           },
  'db.migrate':           { input: DbMigrateInput,           output: DbMigrateOutput           },
  'db.query':             { input: DbQueryInput,             output: DbQueryOutput             },
  'integration.invoke':   { input: IntegrationInvokeInput,   output: IntegrationInvokeOutput   },
} as const;

export type ToolName = keyof typeof TOOL_CONTRACTS;
