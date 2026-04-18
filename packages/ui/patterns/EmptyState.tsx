// packages/ui/patterns/EmptyState.tsx — label + reason + next-step. Never blank.
import * as React from 'react';
import { clsx } from 'clsx';

export interface EmptyStateProps {
  /** What belongs here (e.g. "No projects yet") */
  title: string;
  /** Why it's empty (context) */
  description?: string;
  /** What the user can do next */
  action?: React.ReactNode;
  /** Optional illustration slot */
  illustration?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  action,
  illustration,
  className,
  compact = false,
}) => (
  <div
    className={clsx('abw-empty', compact && 'abw-empty--compact', className)}
    role="status"
    aria-label={title}
  >
    {illustration && (
      <div className="abw-empty__illustration" aria-hidden="true">
        {illustration}
      </div>
    )}
    <p className="abw-empty__title">{title}</p>
    {description && <p className="abw-empty__description">{description}</p>}
    {action && <div className="abw-empty__action">{action}</div>}
  </div>
);
EmptyState.displayName = 'EmptyState';
