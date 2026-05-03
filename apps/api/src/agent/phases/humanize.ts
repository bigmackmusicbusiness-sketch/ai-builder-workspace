// apps/api/src/agent/phases/humanize.ts — Phase B': Humanizer subagent.
//
// Single API call. Input: copy.json + voice profile + niche. Output: humanized
// copy.json with em-dashes replaced, AI-tells stripped, sentence-length variance
// achieved. SOP at apps/api/src/agent/skills/humanize.md.
//
// Foundation step: stub + AI-tell detection helpers.

/** AI-tell detection patterns. Used both by the humanizer SOP markdown
 *  (referenced) and as a quick statistical check inside the polish phase. */
export const AI_TELL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /—/g,                                           label: 'em-dash'                 },
  { pattern: /\bdelve\s+(into|deeply|further)\b/gi,          label: 'delve'                   },
  { pattern: /\bleverage\b/gi,                                label: 'leverage'                },
  { pattern: /\brobust\b/gi,                                  label: 'robust'                  },
  { pattern: /\bseamless(ly)?\b/gi,                           label: 'seamless'                },
  { pattern: /\bunleash\b/gi,                                 label: 'unleash'                 },
  { pattern: /\bin today's fast-paced world\b/gi,             label: 'fast-paced-world'        },
  { pattern: /\bwe believe that\b/gi,                         label: 'we-believe'              },
  { pattern: /\bnavigate the (complexities|landscape) of\b/gi, label: 'navigate-complexities' },
  { pattern: /\b(it'?s|its) worth (noting|mentioning)\b/gi,   label: 'worth-noting'            },
  { pattern: /\b(crucial|pivotal) to (note|understand|recognize)\b/gi, label: 'crucial-pivotal' },
];

/** Count AI-tell hits in a body of text. Used by polish phase as a sanity check. */
export function countAITells(text: string): { total: number; byLabel: Record<string, number> } {
  const byLabel: Record<string, number> = {};
  let total = 0;
  for (const { pattern, label } of AI_TELL_PATTERNS) {
    const matches = text.match(pattern);
    const n = matches?.length ?? 0;
    if (n > 0) {
      byLabel[label] = (byLabel[label] ?? 0) + n;
      total += n;
    }
  }
  return { total, byLabel };
}

/** Compute sentence-length stddev for burstiness check. Higher = more human. */
export function sentenceLengthStddev(text: string): number {
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0);
  if (sentences.length < 2) return 0;
  const lengths = sentences.map((s) => s.trim().split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, x) => sum + (x - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance);
}

export interface HumanizeInput {
  copyDoc:       Record<string, unknown>;
  voice:         string;
  niche:         string;
}

export interface HumanizeResult {
  ok:        boolean;
  copyDoc?:  Record<string, unknown>;
  metrics?:  { tellsRemoved: number; finalStddev: number };
  error?:    string;
}

export async function runHumanizer(input: HumanizeInput): Promise<HumanizeResult> {
  void input;
  return { ok: false, error: 'Humanizer not yet implemented (Step 2)' };
}
