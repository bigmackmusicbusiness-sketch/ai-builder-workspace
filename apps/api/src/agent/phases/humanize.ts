// apps/api/src/agent/phases/humanize.ts — Post-process humanizer.
//
// Two modes:
//   1. Subagent (full): single MiniMax call with humanize.md SOP, rewrites
//      copy.json. Preferred when we have a structured copy doc.
//   2. Inline (fast): regex-based swap pass over written HTML files. Cheaper,
//      runs as a post-process after the legacy iteration loop completes.
//
// Step 2 ships mode 2 — inline pass over HTML files. Mode 1 lands when we
// have full `copy.json` flow (Step 4+).

import type { WorkspaceHandle } from '../../preview/workspace';
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from '../../preview/workspace';

/** AI-tell detection patterns. Used by the inline humanizer + polish phase. */
export const AI_TELL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /—/g,                                                      label: 'em-dash'              },
  { pattern: /\bdelve\s+(into|deeply|further|more)\b/gi,                label: 'delve'                },
  { pattern: /\bleverage\b/gi,                                          label: 'leverage'             },
  { pattern: /\brobust\b/gi,                                            label: 'robust'               },
  { pattern: /\bseamless(ly)?\b/gi,                                     label: 'seamless'             },
  { pattern: /\bunleash\b/gi,                                           label: 'unleash'              },
  { pattern: /\bin today's fast-paced world\b/gi,                       label: 'fast-paced-world'     },
  { pattern: /\bwe believe that\b/gi,                                   label: 'we-believe'           },
  { pattern: /\bnavigate the (complexities|landscape) of\b/gi,          label: 'navigate-complexities' },
  { pattern: /\b(it'?s|its) worth (noting|mentioning)\b/gi,             label: 'worth-noting'         },
  { pattern: /\b(crucial|pivotal) to (note|understand|recognize)\b/gi,  label: 'crucial-pivotal'      },
];

/** Concrete swap table for the inline humanizer. Order matters — apply most
 *  context-sensitive swaps first. */
export const SWAP_TABLE: Array<{ pattern: RegExp; replacement: string | ((match: string) => string) }> = [
  // Drop entire opening clichés
  { pattern: /\bin today's fast-paced world,?\s*/gi,                  replacement: '' },
  { pattern: /\bin today's (digital|modern) (age|world|era),?\s*/gi, replacement: '' },
  { pattern: /\bit'?s worth (noting|mentioning) that\s+/gi,           replacement: '' },
  { pattern: /\b(crucial|pivotal) to (note|understand|recognize) that\s+/gi, replacement: '' },
  { pattern: /\bwe believe that\s+/gi,                                 replacement: '' },
  { pattern: /\bwe strive to\s+/gi,                                    replacement: '' },

  // Word-level swaps
  { pattern: /\bdelve\s+(?:into|deeply|further|more)\b/gi,             replacement: 'look at' },
  { pattern: /\bdelve\b/gi,                                            replacement: 'look at' },
  { pattern: /\bleverage\b/gi,                                         replacement: 'use' },
  { pattern: /\bunleash\b/gi,                                          replacement: 'release' },
  { pattern: /\bnavigate the complexities of\b/gi,                     replacement: 'handle' },
  { pattern: /\bnavigate the landscape of\b/gi,                        replacement: 'work with' },

  // Hedging adverbs (drop standalone, preserve before adjective)
  { pattern: /\b(really|very|quite|rather)\s+(?=\w)/gi,                replacement: '' },

  // Em-dash → comma (most contexts), preserves nice rhythm
  { pattern: /\s*—\s*/g,                                               replacement: ', ' },

  // Stacked filler adjectives — pick the first one
  { pattern: /\binnovative,\s+cutting-edge,?\s+(?:and\s+)?/gi,         replacement: 'innovative ' },
  { pattern: /\bcutting-edge,\s+innovative,?\s+(?:and\s+)?/gi,         replacement: 'cutting-edge ' },
];

/** Apply the swap table to a body of text. Returns rewritten text + count of swaps. */
export function humanizeText(text: string): { text: string; swaps: number } {
  let result = text;
  let total = 0;
  for (const { pattern, replacement } of SWAP_TABLE) {
    if (typeof replacement === 'function') {
      const matches = result.match(pattern);
      if (matches) total += matches.length;
      result = result.replace(pattern, replacement as (match: string) => string);
    } else {
      const before = result;
      result = result.replace(pattern, replacement);
      // Approximate count: difference in char length isn't perfect but close enough for telemetry
      if (before !== result) {
        const matches = before.match(pattern);
        if (matches) total += matches.length;
      }
    }
  }
  return { text: result, swaps: total };
}

/** Compute sentence-length stddev for a body of text. */
export function sentenceLengthStddev(text: string): number {
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0);
  if (sentences.length < 2) return 0;
  const lengths = sentences.map((s) => s.trim().split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, x) => sum + (x - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance);
}

/** Count AI-tell hits in a body of text. */
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

// ── Inline humanizer pass ─────────────────────────────────────────────────────

/** Run the inline humanizer over all HTML files in a workspace. Replaces
 *  AI-tells in user-visible text content (between tags), preserves attribute
 *  values + script/style blocks. Returns total swap count + per-file breakdown. */
export async function runInlineHumanizer(ws: WorkspaceHandle): Promise<{
  ok:          boolean;
  filesTouched: number;
  totalSwaps:  number;
  perFile:     Array<{ path: string; swaps: number; tellsBefore: number; tellsAfter: number }>;
  error?:      string;
}> {
  const perFile: Array<{ path: string; swaps: number; tellsBefore: number; tellsAfter: number }> = [];
  let totalSwaps = 0;
  let filesTouched = 0;

  try {
    const files = await listWorkspaceFiles(ws);
    const htmlFiles = files.filter((p) => /\.html?$/i.test(p));

    for (const path of htmlFiles) {
      const content = await readWorkspaceFile(ws, path);
      if (!content) continue;

      const tellsBefore = countAITells(content).total;
      if (tellsBefore === 0) {
        perFile.push({ path, swaps: 0, tellsBefore: 0, tellsAfter: 0 });
        continue;
      }

      // Surgical: humanize only text between tags + attribute values that are
      // human-readable. Skip <script>, <style>, attribute names, opening/closing tags.
      const rewritten = humanizeHtml(content);

      const tellsAfter = countAITells(rewritten.html).total;
      if (rewritten.swaps > 0) {
        await writeWorkspaceFile(ws, path, rewritten.html);
        filesTouched++;
        totalSwaps += rewritten.swaps;
      }
      perFile.push({ path, swaps: rewritten.swaps, tellsBefore, tellsAfter });
    }

    return { ok: true, filesTouched, totalSwaps, perFile };
  } catch (err) {
    return {
      ok:           false,
      filesTouched: 0,
      totalSwaps:   0,
      perFile,
      error:        err instanceof Error ? err.message : String(err),
    };
  }
}

/** Humanize only the user-visible text portions of an HTML document. Skips
 *  <script>, <style>, <pre>, <code>, and HTML attribute names. */
function humanizeHtml(html: string): { html: string; swaps: number } {
  // Tokenize: split on <script>...</script>, <style>...</style>, <pre>...</pre>, <code>...</code>
  // and tag boundaries. We only humanize the "text content" tokens.
  const segments: Array<{ type: 'text' | 'preserve'; content: string }> = [];
  const preservePattern = /(<(?:script|style|pre|code)\b[^>]*>[\s\S]*?<\/(?:script|style|pre|code)>|<[^>]+>)/gi;

  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = preservePattern.exec(html)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', content: html.slice(lastIdx, match.index) });
    }
    segments.push({ type: 'preserve', content: match[0] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < html.length) {
    segments.push({ type: 'text', content: html.slice(lastIdx) });
  }

  let totalSwaps = 0;
  const out = segments.map((seg) => {
    if (seg.type === 'preserve') return seg.content;
    const { text, swaps } = humanizeText(seg.content);
    totalSwaps += swaps;
    return text;
  }).join('');

  return { html: out, swaps: totalSwaps };
}
