// packages/ui/tokens/spacing.ts — spacing scale per UI Playbook.
// Only these values are permitted. Never deviate.
export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  6: '24px',
  8: '32px',
  10: '40px',
} as const;

export type SpacingKey = keyof typeof spacing;

/** CSS var names that map to this scale (defined in packages/ui/styles/variables.css) */
export const spacingVar = {
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  6: 'var(--space-6)',
  8: 'var(--space-8)',
  10: 'var(--space-10)',
} as const;
