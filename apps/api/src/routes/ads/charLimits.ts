// apps/api/src/routes/ads/charLimits.ts — Meta Ads char limits per placement.
//
// Numbers from the Meta Ads Manager spec sheet (May 2026). The IG Reels
// placement uses the same field constraints as IG Stories. Marketplace
// uses Feed limits. Anything beyond "recommended" still publishes but
// gets truncated in some surfaces — flag, don't reject.

export type Placement = 'feed' | 'stories' | 'reels' | 'marketplace';

export interface CharLimits {
  primaryText:  number;     // Body copy
  headline:     number | null;
  description:  number | null;
  /** When a value is null, the field is not shown in that placement. */
}

export const META_CHAR_LIMITS: Record<Placement, CharLimits> = {
  feed:        { primaryText: 125, headline: 27, description: 25 },
  stories:     { primaryText: 125, headline: 40, description: null },
  reels:       { primaryText: 125, headline: 40, description: null },
  marketplace: { primaryText: 125, headline: 27, description: 25 },
};

export interface CharLimitWarning {
  field: 'primaryText' | 'headline' | 'description';
  limit: number;
  actual: number;
}

/**
 * Validate copy length against the placement's recommended limits.
 * Returns warnings (NOT errors) — anything over the limit publishes but
 * may be truncated on Meta's surfaces.
 */
export function checkCharLimits(input: {
  placement:    Placement;
  headline?:    string;
  primaryText?: string;
  description?: string;
}): CharLimitWarning[] {
  const limits = META_CHAR_LIMITS[input.placement];
  const out: CharLimitWarning[] = [];
  if (input.primaryText && input.primaryText.length > limits.primaryText) {
    out.push({ field: 'primaryText', limit: limits.primaryText, actual: input.primaryText.length });
  }
  if (limits.headline !== null && input.headline && input.headline.length > limits.headline) {
    out.push({ field: 'headline', limit: limits.headline, actual: input.headline.length });
  }
  if (limits.description !== null && input.description && input.description.length > limits.description) {
    out.push({ field: 'description', limit: limits.description, actual: input.description.length });
  }
  return out;
}

/** Per-placement video duration recommendations (seconds). */
export const META_VIDEO_DURATIONS: Record<Placement, { min: number; max: number; idealMax: number }> = {
  feed:        { min: 1, max: 14460, idealMax: 60 },   // theoretical 241 min cap
  stories:     { min: 1, max: 120,   idealMax: 60 },
  reels:       { min: 1, max: 90,    idealMax: 30 },
  marketplace: { min: 1, max: 14460, idealMax: 60 },
};
