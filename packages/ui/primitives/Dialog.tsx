// packages/ui/primitives/Dialog.tsx — Radix Dialog with overlay + accessible structure.
import * as React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  className,
  size = 'md',
}) => (
  <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="abw-dialog__overlay" />
      <RadixDialog.Content
        className={clsx('abw-dialog__content', `abw-dialog__content--${size}`, className)}
      >
        <div className="abw-dialog__header">
          <RadixDialog.Title className="abw-dialog__title">{title}</RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="abw-dialog__description">
              {description}
            </RadixDialog.Description>
          )}
        </div>
        <div className="abw-dialog__body">{children}</div>
        <RadixDialog.Close className="abw-dialog__close" aria-label="Close dialog">
          ×
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>
);
Dialog.displayName = 'Dialog';
