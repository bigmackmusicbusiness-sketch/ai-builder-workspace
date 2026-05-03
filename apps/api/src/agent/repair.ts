// apps/api/src/agent/repair.ts — tool-call repair pipeline.
//
// When MiniMax emits a write_file (or similar) call with malformed args:
//   1. Heroic recovery (5 fallback modes) in tools.ts runs first.
//   2. If that fails, we send a one-shot repair message to MiniMax: "Your last
//      call failed validation: <errors>. Reply with ONE corrected call."
//   3. If THAT fails, we hand the malformed payload to a fallback model
//      (GPT-4o-mini or Claude Haiku) and ask it to extract {path, content}.
//
// Foundation step: stub. Step 3 wires the OpenAI fallback-model call.

export interface RepairInput {
  /** The malformed args MiniMax sent. */
  rawArgs:        string;
  /** The tool that was being called. */
  toolName:       string;
  /** Validation error from Zod or similar. */
  validationError: string;
}

export interface RepairResult {
  ok:            boolean;
  /** Repaired args object, if recovery succeeded. */
  repairedArgs?: Record<string, unknown>;
  /** Which layer of repair produced the result. */
  layer?:        'minimax-retry' | 'fallback-model';
  error?:        string;
}

export async function repairToolCall(input: RepairInput): Promise<RepairResult> {
  void input;
  return {
    ok:    false,
    error: 'Repair pipeline not yet implemented (Step 3)',
  };
}
