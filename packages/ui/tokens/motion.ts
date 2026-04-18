// packages/ui/tokens/motion.ts — restrained, purposeful motion.
// Every animation must: clarify spatial relationship, reinforce hierarchy,
// show state change, soften a transition, or direct attention.
// If it does none of those, remove it.

export const duration = {
  fast: '120ms',
  base: '180ms',
  slow: '240ms',
} as const;

export const easing = {
  standard:    'cubic-bezier(0.2, 0, 0, 1)',
  decelerate:  'cubic-bezier(0, 0, 0.2, 1)',
  accelerate:  'cubic-bezier(0.4, 0, 1, 1)',
} as const;

/** CSS media query for reduced motion. Use before defining any animation. */
export const REDUCED_MOTION_QUERY = '@media (prefers-reduced-motion: reduce)';

/** Shorthand transitions safe for performance (opacity + transform only) */
export const transition = {
  fade:     `opacity ${duration.base} ${easing.standard}`,
  slide:    `transform ${duration.base} ${easing.decelerate}`,
  fadeFast: `opacity ${duration.fast} ${easing.standard}`,
  none:     'none',
} as const;
