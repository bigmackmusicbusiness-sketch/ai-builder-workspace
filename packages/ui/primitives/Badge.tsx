// packages/ui/primitives/Badge.tsx — status and count badges.
// Never rely on color alone to communicate meaning.
import * as React from 'react';
import { clsx } from 'clsx';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  dot = false,
  className,
  children,
  ...rest
}) => (
  <span
    className={clsx('abw-badge', `abw-badge--${variant}`, dot && 'abw-badge--dot', className)}
    {...rest}
  >
    {dot && <span className="abw-badge__dot" aria-hidden="true" />}
    {children}
  </span>
);
Badge.displayName = 'Badge';
