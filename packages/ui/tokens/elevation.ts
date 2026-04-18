// packages/ui/tokens/elevation.ts — subtle by default.
// Do not stack heavy borders + heavy shadows together.

export const elevation = {
  /** Page background — no shadow */
  base: 'none',
  /** Cards, panels, dropdown triggers */
  elevated: '0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.06)',
  /** Modals, overlays, popovers */
  overlay: '0 10px 24px -4px rgba(0,0,0,0.12), 0 4px 8px -2px rgba(0,0,0,0.06)',
} as const;

export type ElevationKey = keyof typeof elevation;
