// packages/ui/primitives/Popover.tsx — Radix Popover, token-compliant.
import * as React from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { clsx } from 'clsx';

export interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const Popover: React.FC<PopoverProps> = ({
  trigger,
  children,
  className,
  side = 'bottom',
  align = 'start',
  open,
  onOpenChange,
}) => (
  <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
    <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
    <RadixPopover.Portal>
      <RadixPopover.Content
        side={side}
        align={align}
        sideOffset={6}
        className={clsx('abw-popover', className)}
      >
        {children}
        <RadixPopover.Arrow className="abw-popover__arrow" />
      </RadixPopover.Content>
    </RadixPopover.Portal>
  </RadixPopover.Root>
);
Popover.displayName = 'Popover';
