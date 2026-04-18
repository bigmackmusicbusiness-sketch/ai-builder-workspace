// packages/ui/primitives/Banner.tsx — inline status banners (warning, error, info, success).
// Used for: fallback-model notices, approval alerts, error states, system notices.
import * as React from 'react';
import { clsx } from 'clsx';

export type BannerVariant = 'info' | 'success' | 'warning' | 'error';

export interface BannerProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BannerVariant;
  title?: string;
  icon?: React.ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}

const defaultIcons: Record<BannerVariant, string> = {
  info:    'ℹ',
  success: '✓',
  warning: '⚠',
  error:   '✕',
};

export const Banner: React.FC<BannerProps> = ({
  variant = 'info',
  title,
  icon,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
  children,
  ...rest
}) => (
  <div
    role={variant === 'error' ? 'alert' : 'status'}
    className={clsx('abw-banner', `abw-banner--${variant}`, className)}
    {...rest}
  >
    <span className="abw-banner__icon" aria-hidden="true">
      {icon ?? defaultIcons[variant]}
    </span>
    <div className="abw-banner__body">
      {title && <p className="abw-banner__title">{title}</p>}
      {children && <div className="abw-banner__content">{children}</div>}
    </div>
    {onDismiss && (
      <button
        type="button"
        onClick={onDismiss}
        className="abw-banner__dismiss"
        aria-label={dismissLabel}
      >
        ×
      </button>
    )}
  </div>
);
Banner.displayName = 'Banner';
