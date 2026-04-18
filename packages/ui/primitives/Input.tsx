// packages/ui/primitives/Input.tsx — label stays visible; no placeholder-as-label.
import * as React from 'react';
import { clsx } from 'clsx';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Always-visible label. Required for accessibility. */
  label: string;
  /** Helper text shown below the field before interaction */
  helperText?: string;
  /** Error message; when present the field is in error state */
  error?: string;
  /** Hide label visually but keep it for screen readers */
  hideLabel?: boolean;
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, helperText, error, hideLabel, wrapperClassName, className, id, ...rest }, ref) => {
    const generatedId = React.useId();
    const fieldId = id ?? generatedId;
    const helpId  = `${fieldId}-help`;
    const errId   = `${fieldId}-err`;

    return (
      <div className={clsx('abw-field', wrapperClassName)}>
        <label
          htmlFor={fieldId}
          className={clsx('abw-field__label', hideLabel && 'sr-only')}
        >
          {label}
          {rest.required && (
            <span aria-hidden="true" className="abw-field__required">*</span>
          )}
        </label>

        <input
          ref={ref}
          id={fieldId}
          aria-describedby={[helperText && helpId, error && errId].filter(Boolean).join(' ') || undefined}
          aria-invalid={!!error || undefined}
          className={clsx('abw-input', error && 'abw-input--error', className)}
          {...rest}
        />

        {helperText && !error && (
          <p id={helpId} className="abw-field__help">{helperText}</p>
        )}
        {error && (
          <p id={errId} role="alert" className="abw-field__error">{error}</p>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
