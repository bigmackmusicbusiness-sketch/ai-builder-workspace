// packages/ui/patterns/SectionDivider.tsx — prefer spacing/alignment over border.
// Use this only when a visual break is genuinely needed after spacing + alignment fail.
import * as React from 'react';
import { clsx } from 'clsx';

export interface SectionDividerProps {
  /** Optional label in the divider (e.g. "Advanced settings") */
  label?: string;
  /** Use 'subtle' (default) before reaching for 'strong' */
  weight?: 'subtle' | 'strong';
  className?: string;
}

export const SectionDivider: React.FC<SectionDividerProps> = ({
  label,
  weight = 'subtle',
  className,
}) => {
  if (label) {
    return (
      <div className={clsx('abw-divider', `abw-divider--${weight}`, 'abw-divider--labeled', className)}>
        <span className="abw-divider__label">{label}</span>
      </div>
    );
  }
  return (
    <hr
      className={clsx('abw-divider', `abw-divider--${weight}`, className)}
      aria-hidden="true"
    />
  );
};
SectionDivider.displayName = 'SectionDivider';
