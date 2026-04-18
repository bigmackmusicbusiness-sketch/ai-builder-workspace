// packages/ui/patterns/LoadingState.tsx — skeleton-first; never blank white.
import * as React from 'react';
import { clsx } from 'clsx';
import { Skeleton } from '../primitives/Skeleton';

export interface LoadingStateProps {
  /** Accessible label read by screen readers */
  label?: string;
  /** Show a spinner instead of skeletons */
  spinner?: boolean;
  /** Number of skeleton rows (default 3) */
  lines?: number;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  label = 'Loading…',
  spinner = false,
  lines = 3,
  className,
}) => (
  <div className={clsx('abw-loading', className)} role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    {spinner ? (
      <div className="abw-loading__spinner" aria-hidden="true" />
    ) : (
      <Skeleton lines={lines} height="0.875rem" />
    )}
  </div>
);
LoadingState.displayName = 'LoadingState';
