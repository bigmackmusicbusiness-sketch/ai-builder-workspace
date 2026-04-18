// packages/ui/patterns/ErrorState.tsx — specific, calm, actionable. Not "something went wrong".
import * as React from 'react';
import { clsx } from 'clsx';

export interface ErrorStateProps {
  title?: string;
  /** Specific reason — say what failed and why if known */
  message: string;
  /** What the user can do now */
  action?: React.ReactNode;
  /** Optional technical detail (e.g. request ID) shown in a collapsible */
  detail?: string;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message,
  action,
  detail,
  className,
}) => {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className={clsx('abw-error-state', className)} role="alert">
      <p className="abw-error-state__title">{title}</p>
      <p className="abw-error-state__message">{message}</p>
      {detail && (
        <div className="abw-error-state__detail">
          <button
            type="button"
            className="abw-error-state__detail-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide detail' : 'Show detail'}
          </button>
          {expanded && (
            <pre className="abw-error-state__detail-body">{detail}</pre>
          )}
        </div>
      )}
      {action && <div className="abw-error-state__action">{action}</div>}
    </div>
  );
};
ErrorState.displayName = 'ErrorState';
