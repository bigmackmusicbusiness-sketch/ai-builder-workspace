// packages/ui/tokens/type.ts — type scale per UI Playbook.
// No ultra-light weights for important content. Body must be readable at 100%.

export const typeScale = {
  display: {
    fontSize:   '2rem',     // 32px
    lineHeight: '1.2',
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },
  h1: {
    fontSize:   '1.5rem',   // 24px
    lineHeight: '1.3',
    fontWeight: '600',
    letterSpacing: '-0.01em',
  },
  h2: {
    fontSize:   '1.25rem',  // 20px
    lineHeight: '1.4',
    fontWeight: '600',
    letterSpacing: '-0.005em',
  },
  h3: {
    fontSize:   '1rem',     // 16px
    lineHeight: '1.5',
    fontWeight: '600',
    letterSpacing: '0',
  },
  body: {
    fontSize:   '0.875rem', // 14px
    lineHeight: '1.6',
    fontWeight: '400',
    letterSpacing: '0',
  },
  bodySm: {
    fontSize:   '0.8125rem', // 13px
    lineHeight: '1.5',
    fontWeight: '400',
    letterSpacing: '0',
  },
  label: {
    fontSize:   '0.75rem',  // 12px
    lineHeight: '1.4',
    fontWeight: '500',
    letterSpacing: '0.01em',
  },
  caption: {
    fontSize:   '0.6875rem', // 11px
    lineHeight: '1.4',
    fontWeight: '400',
    letterSpacing: '0.02em',
  },
} as const;

export type TypeRole = keyof typeof typeScale;
