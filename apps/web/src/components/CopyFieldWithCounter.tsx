// apps/web/src/components/CopyFieldWithCounter.tsx — text input with char counter.
//
// Visual contract:
//   • Counter on the right of the label
//   • At/above the recommended limit, the counter and the input border turn red
//   • The component is purely presentational — the parent owns state
//
// Used by Ads Studio for headline / primary text / description fields.
import type { ChangeEvent } from 'react';

interface Props {
  label:    string;
  value:    string;
  onChange: (v: string) => void;
  /** Recommended char limit. Counter goes red when value.length > limit. */
  limit:    number | null;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
  rows?: number;
}

export function CopyFieldWithCounter({
  label, value, onChange, limit,
  multiline = false, placeholder, hint, rows = 3,
}: Props) {
  const overLimit = limit != null && value.length > limit;

  const inputProps = {
    value,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder,
    style: {
      width: '100%',
      padding: 'var(--space-2)',
      border: `1px solid ${overLimit ? 'var(--color-error)' : 'var(--border-base)'}`,
      borderRadius: 'var(--radius-field)',
      background: 'var(--surface-base)',
      color: 'var(--text-primary)',
      fontSize: '0.875rem',
      lineHeight: 1.4,
      fontFamily: 'inherit',
      resize: multiline ? ('vertical' as const) : ('none' as const),
    },
  };

  return (
    <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 4,
      }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          {label}
        </span>
        {limit !== null && (
          <span style={{
            fontSize: '0.6875rem',
            color: overLimit ? 'var(--color-error)' : 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: overLimit ? 600 : 400,
          }} aria-live="polite">
            {value.length} / {limit}
          </span>
        )}
      </div>
      {multiline ? <textarea rows={rows} {...inputProps} /> : <input type="text" {...inputProps} />}
      {hint && (
        <div style={{ fontSize: '0.625rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
          {hint}
        </div>
      )}
      {overLimit && limit != null && (
        <div role="alert" style={{ fontSize: '0.6875rem', color: 'var(--color-error)', marginTop: 4 }}>
          Over recommended length — Meta may truncate this on some surfaces.
        </div>
      )}
    </label>
  );
}
