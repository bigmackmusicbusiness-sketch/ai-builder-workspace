// packages/ui/tokens/color.ts — single accent + neutral scale + semantic.
// Hard rule: never communicate state with color alone. Always pair with text/icon.

export const neutral = {
  0:   '#ffffff',
  50:  '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#d1d1d6',
  400: '#a1a1aa',
  500: '#71717a',
  600: '#52525b',
  700: '#3f3f46',
  800: '#27272a',
  900: '#18181b',
  950: '#09090b',
} as const;

/** One accent — violet. Do not add a second accent color. */
export const accent = {
  50:  '#f5f3ff',
  100: '#ede9fe',
  200: '#ddd6fe',
  300: '#c4b5fd',
  400: '#a78bfa',
  500: '#8b5cf6',  // primary
  600: '#7c3aed',
  700: '#6d28d9',
  800: '#5b21b6',
  900: '#4c1d95',
} as const;

export const semantic = {
  success:     '#16a34a',  // green-600
  successBg:   '#f0fdf4',  // green-50
  successBorder:'#bbf7d0', // green-200

  warning:     '#d97706',  // amber-600
  warningBg:   '#fffbeb',  // amber-50
  warningBorder:'#fde68a', // amber-200

  error:       '#dc2626',  // red-600
  errorBg:     '#fef2f2',  // red-50
  errorBorder: '#fecaca',  // red-200

  info:        '#2563eb',  // blue-600
  infoBg:      '#eff6ff',  // blue-50
  infoBorder:  '#bfdbfe',  // blue-200
} as const;

export type NeutralKey  = keyof typeof neutral;
export type AccentKey   = keyof typeof accent;
export type SemanticKey = keyof typeof semantic;
