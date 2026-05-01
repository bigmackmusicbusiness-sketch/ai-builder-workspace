// packages/ui/primitives/Toggle.tsx — accessible iOS-style switch + optional label.
// Two sizes (sm | md). Supports controlled + uncontrolled use.
//
// Markup:  <button role="switch" aria-checked> with sliding thumb.
// CSS:     .abw-toggle, .abw-toggle--sm, .abw-toggle__thumb (in primitives.css)
import * as React from 'react';
import { clsx } from 'clsx';

export type ToggleSize = 'sm' | 'md';

export interface ToggleProps {
  /** Controlled value. If provided, component is controlled. */
  checked?:        boolean;
  /** Initial value for uncontrolled use. */
  defaultChecked?: boolean;
  /** Called whenever the value flips. */
  onChange?:       (next: boolean) => void;
  /** Disabled state. Visually muted, click does nothing. */
  disabled?:       boolean;
  /** Visible label, sits to the LEFT of the switch. Pass `null` for no label. */
  label?:          React.ReactNode;
  /** Tooltip / aria-label override when label is iconic only. */
  ariaLabel?:      string;
  /** Smaller size (h: 18px, w: 32px) for dense UIs. Default `md` (h: 22px, w: 40px). */
  size?:           ToggleSize;
  /** Optional accent color override (CSS var name without `--`). */
  accent?:         string;
  /** Pass through className/id/data-* etc. */
  className?:      string;
  id?:             string;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  defaultChecked = false,
  onChange,
  disabled = false,
  label,
  ariaLabel,
  size = 'md',
  accent,
  className,
  id,
}) => {
  const isControlled = checked !== undefined;
  const [internal, setInternal] = React.useState(defaultChecked);
  const value = isControlled ? !!checked : internal;

  const flip = () => {
    if (disabled) return;
    const next = !value;
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  const switchEl = (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={value}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      disabled={disabled}
      onClick={flip}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          flip();
        }
      }}
      className={clsx(
        'abw-toggle',
        size === 'sm' && 'abw-toggle--sm',
        value && 'abw-toggle--on',
        disabled && 'abw-toggle--disabled',
      )}
      style={accent && value ? { ['--abw-toggle-accent' as string]: `var(--${accent})` } : undefined}
    >
      <span className="abw-toggle__thumb" aria-hidden />
    </button>
  );

  if (label === undefined || label === null) return React.cloneElement(switchEl, { className: clsx(switchEl.props.className, className) });

  return (
    <label className={clsx('abw-toggle-row', disabled && 'abw-toggle-row--disabled', className)}>
      <span className="abw-toggle-row__label">{label}</span>
      {switchEl}
    </label>
  );
};
Toggle.displayName = 'Toggle';
