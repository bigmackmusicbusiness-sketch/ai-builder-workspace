// apps/api/src/routes/ads/copyPatterns.ts — niche-aware ad copy templates.
//
// The Ads Studio reads the niche from the linked project (or the niche the
// user selects in the modal when there's no project). For each niche we
// store a handful of high-converting headline + primary-text frames. These
// are used to:
//   1. Seed the copy fields when a new ad is created (so the user is never
//      staring at a blank field).
//   2. Generate A/B variants on Render so the user gets multiple angles
//      side-by-side.
//
// Every pattern aims at the "specific value prop / pattern interrupt /
// before-after" framework — no generic "amazing transformative results"
// phrasing. See the slopBlocker module for the words we explicitly reject.

export type FrameworkId = 'specific-value-prop' | 'pattern-interrupt' | 'before-after';

export interface CopyPattern {
  framework: FrameworkId;
  headline:  string;     // short — fits Meta's 27/40/40 char limits where possible
  primary:   string;     // longer — under 125 for Feed
}

/** Patterns map: niche slug → ordered list of patterns. The Studio cycles
 *  through them (or picks deterministically based on the framework button
 *  the user clicked). */
export const COPY_PATTERNS: Record<string, CopyPattern[]> = {
  'specialty-cafe': [
    {
      framework: 'specific-value-prop',
      headline:  'Sourdough fresh out of the oven at 7am.',
      primary:   'Single-origin Ethiopian Yirgacheffe pour-over and sourdough out of the oven by 7am. 1402 Pearl St — open 6:30 to 4.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'We weighed every shot on a $400 scale.',
      primary:   'Every espresso pulled at 18g in / 36g out, ±0.2g. That precision is why our latte tastes the same on Tuesday as it does on Sunday.',
    },
    {
      framework: 'before-after',
      headline:  'Burnt drip → honey-sweet pour-over.',
      primary:   "If your last cup tasted like ash, you've been drinking dark-roast cover-up. Try a light-roast washed Ethiopian — actual fruit, no scorch.",
    },
  ],
  'real-estate-agent': [
    {
      framework: 'specific-value-prop',
      headline:  '3-bed lakefront. Showings by appt only.',
      primary:   '3-bed, 2-bath lakefront in Incline Village. 0.4 mi to private beach. Listed at $2.4M, no co-listing. Showings Friday by appointment.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '7 listings I refused to take last month.',
      primary:   "I turned down 7 listings in March because the seller's price was 12% over comps. The 4 I took all sold above ask. That's the standard.",
    },
    {
      framework: 'before-after',
      headline:  'On the market 47 days. Sold in 4.',
      primary:   "Same house. Same price. Different agent. We re-staged, re-shot, and re-listed Tuesday — under contract Saturday at $14k over ask.",
    },
  ],
  'law-firm': [
    {
      framework: 'specific-value-prop',
      headline:  'Federal appellate counsel, 4 circuits.',
      primary:   'Bar-admitted in the 2nd, 3rd, 9th, and DC Circuits. 18 years of federal appellate practice. Free 30-min case review for trial counsel.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  "I've argued 6 times in front of Judge Lin.",
      primary:   "If your case is in the SDNY commercial division, you want a litigator who knows the bench. I've appeared before all four judges in the past 18 months.",
    },
    {
      framework: 'before-after',
      headline:  '$340k judgment → $0 owed.',
      primary:   'Client came in with a $340k state-court verdict against him. Removed to federal court, raised an FAA preemption defense, judgment vacated in 6 months.',
    },
  ],
  'fitness-studio': [
    {
      framework: 'specific-value-prop',
      headline:  '5:30am barbell class. Coach-led, 8 max.',
      primary:   'Strength program written by a USAW-1 coach. 8-person cap so form gets corrected every set. Mon/Wed/Fri 5:30am.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'No mirrors. No music. No screens.',
      primary:   "Old-school weight room. The only feedback you get is your coach's voice and the clock on the wall. 6 weeks, 18 sessions, $240.",
    },
    {
      framework: 'before-after',
      headline:  'Couch → 5K in 9 weeks.',
      primary:   '12-person beginner running group. Coach-led, accountability check-ins, no judgment. 9 weeks from 0 to a Saturday-morning 5K. Next cohort starts Sept 4.',
    },
  ],
  'wedding-venue': [
    {
      framework: 'specific-value-prop',
      headline:  'Driftwood Cove. 14 dates left in 2026.',
      primary:   'Cliff-top oceanfront ceremony space, indoor 220-seat reception. Catering preferred-vendor list, no required minimums. 14 dates remaining for 2026.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Fog rolled in. We had a backup.',
      primary:   "Marin coastal weddings get foggy 1 day in 4 — that's why our covered ceremony lawn becomes the indoor chapel in 12 minutes flat. No tarp scramble.",
    },
    {
      framework: 'before-after',
      headline:  'Booked Saturday → walked it Sunday.',
      primary:   "Couples who book a Saturday tour walk the property Sunday morning before they sign. We've found that's when the doubt either evaporates or surfaces — and we'd rather know.",
    },
  ],
};

/** Fallback for niches without curated patterns — generic but framework-shaped,
 *  not slop. Used as a last-resort seed; the user is expected to edit. */
export const FALLBACK_PATTERNS: CopyPattern[] = [
  {
    framework: 'specific-value-prop',
    headline:  '{One specific thing you do}',
    primary:   "{One specific outcome for one specific customer.} {One concrete number.} {One concrete next step — the address, hours, or how to book.}",
  },
  {
    framework: 'pattern-interrupt',
    headline:  '{A number, named place, or unexpected detail}',
    primary:   "{Open with the surprising fact.} {Connect it to why your customer should care.} {Close with the specific action.}",
  },
  {
    framework: 'before-after',
    headline:  '{Old state} → {New state}',
    primary:   '{Describe the old state in one concrete sentence.} {Describe the new state in one concrete sentence.} {The thing that bridged them is your offer.}',
  },
];

/**
 * Pick patterns for a niche, falling back to a generic frame when the
 * niche is unknown. Always returns at least one pattern.
 */
export function patternsForNiche(niche?: string | null): CopyPattern[] {
  if (!niche) return FALLBACK_PATTERNS;
  return COPY_PATTERNS[niche] ?? FALLBACK_PATTERNS;
}

/**
 * Pick a pattern for a specific framework — used when the user clicks the
 * framework picker. Returns the first pattern matching that framework, or
 * the generic fallback for that framework if no niche pattern matches.
 */
export function patternForFramework(niche: string | undefined, framework: FrameworkId): CopyPattern {
  const patterns = patternsForNiche(niche);
  const match = patterns.find((p) => p.framework === framework);
  if (match) return match;
  const fallback = FALLBACK_PATTERNS.find((p) => p.framework === framework);
  return fallback ?? FALLBACK_PATTERNS[0]!;
}

/**
 * Generate 2 A/B variants from a primary pattern. The variants pick the
 * "other two" frameworks so the user gets visibly different angles.
 */
export function generateVariants(niche: string | undefined, primary: CopyPattern): CopyPattern[] {
  const allFrameworks: FrameworkId[] = ['specific-value-prop', 'pattern-interrupt', 'before-after'];
  return allFrameworks
    .filter((f) => f !== primary.framework)
    .map((f) => patternForFramework(niche, f));
}
