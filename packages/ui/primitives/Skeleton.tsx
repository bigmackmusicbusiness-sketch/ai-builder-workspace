// packages/ui/primitives/Skeleton.tsx — loading placeholder. Never leave blank.
import * as React from 'react';
import { clsx } from 'clsx';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Width as CSS value */
  width?: string | number;
  /** Height as CSS value */
  height?: string | number;
  /** Pill shape (for avatar/badge loading) */
  circle?: boolean;
  /** Number of lines (stacked skeletons) */
  lines?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height = '1em',
  circle = false,
  lines,
  className,
  style,
  ...rest
}) => {
  if (lines && lines > 1) {
    return (
      <div className={clsx('abw-skeleton-group', className)} {...rest}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="abw-skeleton"
            style={{
              width: i === lines - 1 ? '60%' : '100%',
              height,
              borderRadius: circle ? '9999px' : 'var(--radius-field)',
            }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={clsx('abw-skeleton', className)}
      style={{
        width: width ?? '100%',
        height,
        borderRadius: circle ? '9999px' : 'var(--radius-field)',
        ...style,
      }}
      aria-hidden="true"
      {...rest}
    />
  );
};
Skeleton.displayName = 'Skeleton';
