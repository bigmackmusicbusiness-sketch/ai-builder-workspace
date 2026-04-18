// packages/ui/primitives/Chip.tsx — pill-shaped tag/filter chips.
import * as React from 'react';
import { clsx } from 'clsx';

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  onRemove?: () => void;
  removeLabel?: string;
  active?: boolean;
}

export const Chip: React.FC<ChipProps> = ({
  onRemove,
  removeLabel = 'Remove',
  active = false,
  className,
  children,
  ...rest
}) => (
  <span
    className={clsx('abw-chip', active && 'abw-chip--active', className)}
    {...rest}
  >
    <span className="abw-chip__label">{children}</span>
    {onRemove && (
      <button
        type="button"
        onClick={onRemove}
        className="abw-chip__remove"
        aria-label={removeLabel}
      >
        ×
      </button>
    )}
  </span>
);
Chip.displayName = 'Chip';
