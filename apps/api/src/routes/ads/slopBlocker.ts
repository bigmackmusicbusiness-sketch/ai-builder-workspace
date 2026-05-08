// apps/api/src/routes/ads/slopBlocker.ts — copy-quality gate for ad creatives.
//
// Refuses to render an ad whose copy contains generic AI-style filler.
// The list is the result of looking at thousands of "made by AI" ads in
// the wild and noting which exact phrases keep showing up. Every match is
// a hard 422 — the user has to edit and retry.
//
// Override: pass `force: true` (set by the SPA's "Render anyway" button
// after the user accepts the slop warning).

const SLOP_PHRASES: { phrase: string; replacement: string }[] = [
  // Adjectives that mean nothing
  { phrase: 'amazing',                replacement: 'Replace with a specific number, address, or fact.' },
  { phrase: 'incredible',             replacement: 'Replace with a specific number, address, or fact.' },
  { phrase: 'awesome',                replacement: 'Replace with a specific number, address, or fact.' },
  { phrase: 'world-class',            replacement: 'Cite the specific credential or comparison instead.' },
  { phrase: 'cutting-edge',           replacement: 'Name the specific tool, technique, or year.' },
  { phrase: 'state-of-the-art',       replacement: 'Name the specific tool, technique, or year.' },
  { phrase: 'next level',             replacement: 'Describe the new state in one concrete sentence.' },
  { phrase: 'next-level',             replacement: 'Describe the new state in one concrete sentence.' },
  { phrase: 'take it to the next',    replacement: 'Describe the new state in one concrete sentence.' },
  { phrase: 'game-changing',          replacement: 'Describe the specific change in one sentence.' },
  { phrase: 'game changing',          replacement: 'Describe the specific change in one sentence.' },
  { phrase: 'revolutionary',          replacement: 'Name the specific thing being replaced.' },
  { phrase: 'transform your business',replacement: 'Describe the specific outcome — what changes, by how much.' },
  { phrase: 'transform your life',    replacement: 'Describe the specific outcome — what changes, by how much.' },
  { phrase: 'unlock your potential',  replacement: 'Describe what the customer can do they cannot do today.' },
  { phrase: 'unleash',                replacement: 'Describe the specific result.' },
  { phrase: 'elevate your',           replacement: 'Describe the specific result.' },
  { phrase: 'one-stop shop',          replacement: 'List the specific 2-3 things you actually do.' },
  { phrase: 'taking the world',       replacement: 'Cite specific market traction.' },
  { phrase: 'best-in-class',          replacement: 'Cite a specific credential or comparison.' },
  { phrase: 'industry-leading',       replacement: 'Cite a specific credential or comparison.' },
  { phrase: 'leverage',               replacement: 'Use "use" or describe the specific action.' },
  { phrase: 'synergies',              replacement: 'Drop the word — describe what actually happens.' },
  { phrase: 'paradigm shift',         replacement: 'Name the specific change.' },

  // Weak CTAs
  { phrase: 'click here',             replacement: 'Use a verb that names the action: "Book a tour", "See pricing".' },
  { phrase: "don't miss out",         replacement: 'Replace with a specific date, time, or count.' },
  { phrase: 'dont miss out',          replacement: 'Replace with a specific date, time, or count.' },
  { phrase: 'limited time only',      replacement: 'Name the specific deadline date.' },
  { phrase: 'act now',                replacement: 'Replace with a specific deadline.' },

  // Vacuous claims
  { phrase: 'so much more',           replacement: 'List the specific 2-3 additional things.' },
  { phrase: 'and more!',              replacement: 'List the specific things.' },
  { phrase: 'just for you',           replacement: 'Drop the phrase — every ad is "for the customer".' },
];

export interface SlopMatch {
  phrase:      string;
  replacement: string;
  fields:      ('headline' | 'primaryText' | 'description' | 'callToAction')[];
}

export interface SlopCheckResult {
  ok:        boolean;
  matches:   SlopMatch[];
  /** A short human-readable summary suitable for the 422 response body. */
  summary:   string;
}

/**
 * Normalize a string before slop matching. Defends against trivial bypass:
 *   • NFKC unicode normalization folds confusable variants
 *   • Curly apostrophes/quotes mapped to ASCII so "don't" matches "don't"
 *   • Zero-width characters (joiners, non-joiners, BOM) stripped
 *   • Non-breaking spaces normalized to regular spaces so "next level"
 *     still matches "next level"
 *   • Lowercase fold for case-insensitive comparison
 */
function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[  ]/g, ' ')
    .toLowerCase();
}

/**
 * Run all slop phrases against the four copy fields. Returns a structured
 * report; if matches.length > 0 and force=false, the route should respond 422.
 */
export function checkAdCopyForSlop(input: {
  headline?:     string;
  primaryText?:  string;
  description?:  string;
  callToAction?: string;
}): SlopCheckResult {
  const fieldMap: Record<string, string | undefined> = {
    headline:     input.headline,
    primaryText:  input.primaryText,
    description:  input.description,
    callToAction: input.callToAction,
  };

  const matches: SlopMatch[] = [];
  for (const { phrase, replacement } of SLOP_PHRASES) {
    const normalizedPhrase = normalize(phrase);
    const fieldsHit: SlopMatch['fields'] = [];
    for (const [field, val] of Object.entries(fieldMap)) {
      if (typeof val === 'string' && normalize(val).includes(normalizedPhrase)) {
        fieldsHit.push(field as SlopMatch['fields'][number]);
      }
    }
    if (fieldsHit.length > 0) {
      matches.push({ phrase, replacement, fields: fieldsHit });
    }
  }

  const ok = matches.length === 0;
  const summary = ok
    ? 'No slop detected — copy passes the quality bar.'
    : `Generic-AI phrases detected: ${matches.map((m) => `"${m.phrase}"`).join(', ')}. Edit the copy and retry, or pass force=true to render anyway.`;

  return { ok, matches, summary };
}
