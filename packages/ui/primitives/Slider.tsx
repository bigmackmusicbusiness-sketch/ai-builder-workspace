// packages/ui/primitives/Slider.tsx — minimal range slider.
// Used for: future Higgsfield "intensity" (1-3 = draft/standard/premium),
// video editor zoom, audio volume, etc.
//
// Wraps a native <input type="range"> for accessibility + keyboard support;
// styled via .abw-slider in primitives.css. Snap-points (`steps`) render
// as small tick marks under the track.
import * as React from 'react';
import { clsx } from 'clsx';

export interface SliderProps {
  value:      number;
  min?:       number;
  max?:       number;
  step?:      number;
  /** Discrete labels under the track. If provided, length must equal (max-min)/step + 1. */
  steps?:     string[];
  onChange:   (next: number) => void;
  disabled?:  boolean;
  ariaLabel?: string;
  className?: string;
  /** Show the current value as a small chip above the thumb. */
  showValue?: boolean;
  /** Optional value formatter. Defaults to String(). */
  formatValue?: (value: number) => string;
}

export const Slider: React.FC<SliderProps> = ({
  value, min = 0, max = 100, step = 1,
  steps, onChange, disabled = false,
  ariaLabel, className, showValue = false,
  formatValue = (v) => String(v),
}) => {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className={clsx('abw-slider', disabled && 'abw-slider--disabled', className)}>
      {showValue && (
        <span className="abw-slider__value" style={{ left: `${pct}%` }}>
          {formatValue(value)}
        </span>
      )}
      <div className="abw-slider__track">
        <div className="abw-slider__fill" style={{ width: `${pct}%` }} />
      </div>
      <input
        type="range"
        className="abw-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {steps && steps.length > 0 && (
        <div className="abw-slider__steps">
          {steps.map((s, i) => (
            <span key={i} className="abw-slider__step-label" style={{ left: `${(i / (steps.length - 1)) * 100}%` }}>
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
Slider.displayName = 'Slider';
