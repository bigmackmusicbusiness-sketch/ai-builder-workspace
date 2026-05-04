// apps/api/src/providers/openai.ts — OpenAI client for fallback repair calls.
//
// Used by:
//   - apps/api/src/agent/repair.ts: when MiniMax can't produce valid tool args
//     after heroic recovery + retry, hand the malformed payload to GPT-4o-mini
//     to extract structured fields. Cheap (~$0.0001-$0.001 per call), high
//     reliability for structured-output extraction.
//
// Not a full ProviderAdapter — just the narrow surface we need for repair.

import { vaultGet } from '../security/vault';

const OPENAI_BASE = 'https://api.openai.com/v1';
const KEY_NAMES   = ['OPENAI_API_KEY', 'OPENAI', 'openai.api_key'];

async function getOpenAIKey(tenantId: string, env: string): Promise<string | null> {
  for (const name of KEY_NAMES) {
    try { return await vaultGet({ name, env, tenantId }); } catch { /* try next */ }
  }
  return null;
}

export async function openAIAvailable(tenantId: string, env: string): Promise<boolean> {
  return !!(await getOpenAIKey(tenantId, env));
}

export interface OpenAIRepairInput {
  /** What the repair model should extract. JSON Schema or natural-language description. */
  instruction:   string;
  /** The malformed payload to extract from. */
  malformedInput: string;
  /** OpenAI model to use. Defaults to gpt-4o-mini for cost. */
  model?:        string;
  tenantId:      string;
  env:           string;
  signal?:       AbortSignal;
}

export interface OpenAIRepairResult {
  ok:        boolean;
  /** Parsed JSON if extraction succeeded. */
  data?:     unknown;
  /** Raw text response. */
  raw?:      string;
  error?:    string;
}

/**
 * Single-shot repair extraction. Sends `malformedInput` + extraction `instruction`
 * to GPT-4o-mini in JSON mode, returns parsed JSON.
 */
export async function openAIRepair(input: OpenAIRepairInput): Promise<OpenAIRepairResult> {
  const apiKey = await getOpenAIKey(input.tenantId, input.env);
  if (!apiKey) {
    return { ok: false, error: 'OPENAI_API_KEY not in vault — cannot run repair fallback' };
  }

  const model = input.model ?? 'gpt-4o-mini';

  const body = {
    model,
    response_format: { type: 'json_object' },
    temperature:     0,
    max_tokens:      2048,
    messages: [
      {
        role:    'system',
        content: 'You are a structured-output extraction tool. Given malformed input, extract the requested fields and respond with VALID JSON ONLY. No prose.',
      },
      {
        role:    'user',
        content: `Extraction instruction:\n${input.instruction}\n\nMalformed input:\n${input.malformedInput}\n\nRespond with valid JSON.`,
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body:   JSON.stringify(body),
      signal: input.signal,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, error: `OpenAI ${res.status}: ${errText.slice(0, 200)}` };
  }

  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try { parsed = await res.json(); } catch { return { ok: false, error: 'OpenAI response not JSON' }; }

  const content = parsed.choices?.[0]?.message?.content?.trim();
  if (!content) return { ok: false, error: 'OpenAI returned empty content' };

  let data: unknown;
  try { data = JSON.parse(content); } catch {
    return { ok: false, raw: content, error: 'OpenAI content was not valid JSON despite json_object mode' };
  }

  return { ok: true, data, raw: content };
}
