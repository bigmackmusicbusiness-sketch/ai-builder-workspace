// apps/api/src/agent/repair.ts — tool-call repair pipeline.
//
// When MiniMax emits a write_file (or similar) call with malformed args:
//   1. Heroic recovery (5 fallback modes) in tools.ts runs first.
//   2. If that fails, this module's `repairToolCall()` runs:
//      a. Hand the malformed payload to GPT-4o-mini and ask it to extract
//         the expected fields. Single shot, ~$0.001 per call.
//   3. Returns repaired args object or a clear error.
//
// Note: the in-loop "MiniMax retry" pass (re-prompting MiniMax to redo the
// call) lives in chat.ts as part of the iteration loop — refusal-recovery.
// This module is the "fallback model" layer specifically.

import { openAIRepair } from '../providers/openai';

export interface RepairInput {
  /** The malformed args MiniMax sent (raw JSON string). */
  rawArgs:        string;
  /** The tool that was being called. */
  toolName:       string;
  /** Optional: schema description / what fields to extract. */
  schemaHint?:    string;
  tenantId:       string;
  env:            string;
  signal?:        AbortSignal;
}

export interface RepairResult {
  ok:            boolean;
  /** Repaired args object, if recovery succeeded. */
  repairedArgs?: Record<string, unknown>;
  /** Which layer produced the result. */
  layer?:        'fallback-model';
  error?:        string;
}

const TOOL_SCHEMAS: Record<string, string> = {
  write_file:
    'Two fields: "path" (relative file path string, e.g. "index.html") and "content" (full file content string).',
  read_file:
    'One field: "path" (relative file path string).',
  list_files:
    'No fields, or one optional field "directory" (relative path).',
  delete_file:
    'One field: "path" (relative file path string).',
  gen_image:
    'Two fields: "prompt" (image description string) and "filename" (e.g. "/images/hero.jpg").',
  propose_plan:
    'One field: "plan" (a JSON object matching the website plan schema with niche, voice, palette, sitemap, shared_assets, asset_budget, compliance_blocks).',
};

/**
 * Tool-call repair via fallback model (GPT-4o-mini).
 * Single-shot. Returns parsed args if successful.
 */
export async function repairToolCall(input: RepairInput): Promise<RepairResult> {
  const schemaHint = input.schemaHint ?? TOOL_SCHEMAS[input.toolName] ?? 'Extract the most likely structured fields.';

  const instruction =
    `Extract the arguments for a ${input.toolName} tool call. ` +
    `Expected shape: ${schemaHint} ` +
    `Return JSON with exactly those fields. ` +
    `If a field is missing from the input, use the most reasonable default ` +
    `(e.g. for write_file with no path, use "index.html"; for content, use ` +
    `the longest string value present).`;

  const result = await openAIRepair({
    instruction,
    malformedInput: input.rawArgs.slice(0, 4000),  // cap input size
    tenantId:       input.tenantId,
    env:            input.env,
    signal:         input.signal,
  });

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error ?? 'fallback-model repair failed' };
  }

  if (typeof result.data !== 'object' || result.data === null) {
    return { ok: false, error: 'repair returned non-object' };
  }

  return {
    ok:           true,
    repairedArgs: result.data as Record<string, unknown>,
    layer:        'fallback-model',
  };
}
