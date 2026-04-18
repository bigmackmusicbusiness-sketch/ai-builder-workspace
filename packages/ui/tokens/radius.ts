// packages/ui/tokens/radius.ts — one consistent shape language.
// Do not mix sharp, pill, and large-rounded shapes on the same screen.

export const radius = {
  /** Form fields and small controls (inputs, selects) */
  field: '6px',
  /** Buttons */
  button: '6px',
  /** Cards, panels, modals */
  card: '10px',
  /** Popovers, tooltips, toasts */
  popover: '8px',
  /** Full pill (badges, chips, tags) */
  pill: '9999px',
} as const;

export type RadiusKey = keyof typeof radius;
