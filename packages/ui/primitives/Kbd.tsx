// packages/ui/primitives/Kbd.tsx — keyboard shortcut display.
import * as React from 'react';
import { clsx } from 'clsx';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {}

export const Kbd: React.FC<KbdProps> = ({ className, children, ...rest }) => (
  <kbd className={clsx('abw-kbd', className)} {...rest}>
    {children}
  </kbd>
);
Kbd.displayName = 'Kbd';
