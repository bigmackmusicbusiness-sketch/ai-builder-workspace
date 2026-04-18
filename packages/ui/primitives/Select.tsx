// packages/ui/primitives/Select.tsx — Radix Select with label/error pattern.
import * as React from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { clsx } from 'clsx';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps {
  label: string;
  placeholder?: string;
  options?: SelectOption[];
  groups?: SelectGroup[];
  value?: string;
  onValueChange?: (value: string) => void;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  hideLabel?: boolean;
  wrapperClassName?: string;
  triggerClassName?: string;
  id?: string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  placeholder = 'Select…',
  options,
  groups,
  value,
  onValueChange,
  error,
  helperText,
  disabled,
  required,
  hideLabel,
  wrapperClassName,
  triggerClassName,
  id,
}) => {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const errId   = `${fieldId}-err`;
  const helpId  = `${fieldId}-help`;

  return (
    <div className={clsx('abw-field', wrapperClassName)}>
      <label
        htmlFor={fieldId}
        className={clsx('abw-field__label', hideLabel && 'sr-only')}
      >
        {label}
        {required && <span aria-hidden="true" className="abw-field__required">*</span>}
      </label>

      <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <RadixSelect.Trigger
          id={fieldId}
          aria-describedby={[helperText && helpId, error && errId].filter(Boolean).join(' ') || undefined}
          aria-invalid={!!error || undefined}
          aria-required={required}
          className={clsx('abw-select__trigger', error && 'abw-select__trigger--error', triggerClassName)}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon className="abw-select__icon">▾</RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content className="abw-select__content" position="popper" sideOffset={4}>
            <RadixSelect.Viewport className="abw-select__viewport">
              {options?.map((opt) => (
                <RadixSelect.Item
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                  className="abw-select__item"
                >
                  <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="abw-select__item-indicator">✓</RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
              {groups?.map((group) => (
                <RadixSelect.Group key={group.label}>
                  <RadixSelect.Label className="abw-select__group-label">{group.label}</RadixSelect.Label>
                  {group.options.map((opt) => (
                    <RadixSelect.Item
                      key={opt.value}
                      value={opt.value}
                      disabled={opt.disabled}
                      className="abw-select__item"
                    >
                      <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                      <RadixSelect.ItemIndicator className="abw-select__item-indicator">✓</RadixSelect.ItemIndicator>
                    </RadixSelect.Item>
                  ))}
                </RadixSelect.Group>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>

      {helperText && !error && <p id={helpId} className="abw-field__help">{helperText}</p>}
      {error && <p id={errId} role="alert" className="abw-field__error">{error}</p>}
    </div>
  );
};
Select.displayName = 'Select';
