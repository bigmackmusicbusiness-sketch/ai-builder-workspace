// packages/ui/primitives/Textarea.tsx — same label/error/helper pattern as Input.
import * as React from 'react';
import { clsx } from 'clsx';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  helperText?: string;
  error?: string;
  hideLabel?: boolean;
  wrapperClassName?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
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
          {rest.required && <span aria-hidden="true" className="abw-field__required">*</span>}
        </label>
        <textarea
          ref={ref}
          id={fieldId}
          aria-describedby={[helperText && helpId, error && errId].filter(Boolean).join(' ') || undefined}
          aria-invalid={!!error || undefined}
          className={clsx('abw-textarea', error && 'abw-textarea--error', className)}
          {...rest}
        />
        {helperText && !error && <p id={helpId} className="abw-field__help">{helperText}</p>}
        {error && <p id={errId} role="alert" className="abw-field__error">{error}</p>}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
