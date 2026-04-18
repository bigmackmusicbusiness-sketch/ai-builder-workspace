// packages/ui/primitives/Button.tsx — primary/secondary/ghost/destructive.
// One primary per area. Loading preserves size. Disabled should explain why.
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { clsx } from 'clsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize    = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Render as child element instead of <button> (useful for links styled as buttons) */
  asChild?: boolean;
  /** Short reason shown on hover when disabled=true */
  disabledReason?: string;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:     'abw-btn--primary',
  secondary:   'abw-btn--secondary',
  ghost:       'abw-btn--ghost',
  destructive: 'abw-btn--destructive',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'abw-btn--sm',
  md: 'abw-btn--md',
  lg: 'abw-btn--lg',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      loading = false,
      asChild = false,
      disabledReason,
      disabled,
      className,
      children,
      title,
      ...rest
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const isDisabled = disabled || loading;

    return (
      <Comp
        ref={ref}
        disabled={isDisabled}
        title={disabled && disabledReason ? disabledReason : title}
        aria-busy={loading || undefined}
        aria-disabled={isDisabled || undefined}
        className={clsx(
          'abw-btn',
          variantStyles[variant],
          sizeStyles[size],
          loading && 'abw-btn--loading',
          isDisabled && 'abw-btn--disabled',
          className,
        )}
        {...rest}
      >
        {loading ? (
          <>
            <span className="abw-btn__spinner" aria-hidden="true" />
            <span className="sr-only">Loading…</span>
            <span aria-hidden="true">{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
