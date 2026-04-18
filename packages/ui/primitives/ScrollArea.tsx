// packages/ui/primitives/ScrollArea.tsx — Radix ScrollArea with custom scrollbar.
import * as React from 'react';
import * as RadixScrollArea from '@radix-ui/react-scroll-area';
import { clsx } from 'clsx';

export interface ScrollAreaProps {
  maxHeight?: string;
  orientation?: 'vertical' | 'horizontal' | 'both';
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export const ScrollArea: React.FC<ScrollAreaProps> = ({
  maxHeight = '100%',
  orientation = 'vertical',
  className,
  style,
  children,
}) => (
  <RadixScrollArea.Root
    className={clsx('abw-scroll-area', className)}
    style={{ maxHeight, ...style }}
  >
    <RadixScrollArea.Viewport className="abw-scroll-area__viewport">
      {children}
    </RadixScrollArea.Viewport>
    {(orientation === 'vertical' || orientation === 'both') && (
      <RadixScrollArea.Scrollbar
        className="abw-scroll-area__scrollbar abw-scroll-area__scrollbar--vertical"
        orientation="vertical"
      >
        <RadixScrollArea.Thumb className="abw-scroll-area__thumb" />
      </RadixScrollArea.Scrollbar>
    )}
    {(orientation === 'horizontal' || orientation === 'both') && (
      <RadixScrollArea.Scrollbar
        className="abw-scroll-area__scrollbar abw-scroll-area__scrollbar--horizontal"
        orientation="horizontal"
      >
        <RadixScrollArea.Thumb className="abw-scroll-area__thumb" />
      </RadixScrollArea.Scrollbar>
    )}
    <RadixScrollArea.Corner />
  </RadixScrollArea.Root>
);
ScrollArea.displayName = 'ScrollArea';
