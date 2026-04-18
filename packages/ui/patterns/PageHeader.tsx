// packages/ui/patterns/PageHeader.tsx — one primary action slot, concise sub.
// Do not turn this into a control junkyard. One primary action max.
import * as React from 'react';
import { clsx } from 'clsx';

export interface PageHeaderProps {
  title: string;
  description?: string;
  primaryAction?: React.ReactNode;
  /** Breadcrumb or supplementary context */
  breadcrumb?: React.ReactNode;
  /** Tabs, filters, or date pickers central to the page — use sparingly */
  toolbar?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  primaryAction,
  breadcrumb,
  toolbar,
  className,
}) => (
  <header className={clsx('abw-page-header', className)}>
    <div className="abw-page-header__top">
      <div className="abw-page-header__meta">
        {breadcrumb && (
          <nav aria-label="Breadcrumb" className="abw-page-header__breadcrumb">
            {breadcrumb}
          </nav>
        )}
        <h1 className="abw-page-header__title">{title}</h1>
        {description && (
          <p className="abw-page-header__description">{description}</p>
        )}
      </div>
      {primaryAction && (
        <div className="abw-page-header__action">{primaryAction}</div>
      )}
    </div>
    {toolbar && <div className="abw-page-header__toolbar">{toolbar}</div>}
  </header>
);
PageHeader.displayName = 'PageHeader';
