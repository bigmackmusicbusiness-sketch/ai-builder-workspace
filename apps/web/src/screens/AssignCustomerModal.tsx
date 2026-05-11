// apps/web/src/screens/AssignCustomerModal.tsx — Round 8 Feature B SPA UI.
//
// Modal launched from the "Assign to new customer" button in PublishScreen
// header. Collects prospect details, POSTs to /api/abw/assign-to-new-customer,
// and on success surfaces the Stripe Checkout URL the rep needs to share
// with the customer.
//
// May 2026 overhaul: niche + package fields are real dropdowns populated
// from `/api/abw/niches` (local manifests) and `/api/abw/packages` (SPS
// proxy with curated fallback) — no more free-text guessing. Error display
// also surfaces the structured fields the ABW wrapper now forwards
// (sps_status, content_type, body preview) so the rep can SEE what came
// back instead of staring at "sps_body_unparseable".
//
// All colors are explicit dark-theme tokens — the previous version used
// `var(--surface-1, #fff)` which had no definition and fell back to white
// on a dark page, making labels invisible against the modal bg.

import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api';

export interface AssignCustomerModalProps {
  projectId:   string;
  projectName: string;
  onClose:     () => void;
}

interface AssignResponse {
  ok:                   true;
  workspace_id:         string;
  organization_id:      string;
  customer_website_id:  string;
  payment_url:          string;
  stripe_session_id:    string;
  pending_until:        string;
}

interface NicheOption   { slug: string; label: string; }
interface PackageOption { slug: string; name: string; monthly_price_cents: number; }

/** Structured error fields the ABW wrapper attaches when SPS fails. Used
 *  to render a useful "what went wrong" block instead of a one-liner. */
interface AssignErrorShape {
  error?:            string;
  sps_status?:       number;
  sps_content_type?: string;
  sps_body_preview?: string;
  sps_body?:         string;
  hint?:             string;
  warning?:          string;
  message?:          string;
  issues?:           unknown;
}

/** USD price formatter — Intl is overkill for known integer cents. */
function fmtPrice(cents: number): string {
  const dollars = (cents / 100).toFixed(2);
  return `$${dollars.replace(/\.00$/, '')}/mo`;
}

export function AssignCustomerModal({ projectId, projectName, onClose }: AssignCustomerModalProps) {
  const [customerEmail, setCustomerEmail] = useState('');
  const [contactName,   setContactName]   = useState('');
  const [businessName,  setBusinessName]  = useState('');
  const [packageSlug,   setPackageSlug]   = useState('');
  const [nicheSlug,     setNicheSlug]     = useState('');

  const [niches,           setNiches]           = useState<NicheOption[]>([]);
  const [packages,         setPackages]         = useState<PackageOption[]>([]);
  const [packagesSource,   setPackagesSource]   = useState<'sps' | 'fallback' | null>(null);
  const [pickersLoading,   setPickersLoading]   = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<AssignErrorShape | null>(null);
  const [result,     setResult]     = useState<AssignResponse | null>(null);
  const [copied,     setCopied]     = useState(false);

  // Load picker data on mount. Both endpoints always 200 (the api falls
  // back to safe defaults), so failures here are network-only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nRes, pRes] = await Promise.all([
          apiFetch<{ items: NicheOption[] }>('/api/abw/niches'),
          apiFetch<{ items: PackageOption[]; source?: 'sps' | 'fallback' }>('/api/abw/packages'),
        ]);
        if (cancelled) return;
        setNiches(nRes.items);
        setPackages(pRes.items);
        setPackagesSource(pRes.source ?? null);
        // Default to the cheapest package so the form is submittable with one click.
        const first = pRes.items[0];
        if (first) setPackageSlug(first.slug);
      } catch {
        // Pickers fail open — the form still submits, just without dropdown options.
      } finally {
        if (!cancelled) setPickersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        project_id:     projectId,
        customer_email: customerEmail.trim(),
        contact_name:   contactName.trim(),
        business_name:  businessName.trim(),
        package_slug:   packageSlug.trim().toLowerCase(),
        niche_slug:     nicheSlug.trim() ? nicheSlug.trim().toLowerCase() : undefined,
      };
      const res = await apiFetch<AssignResponse>('/api/abw/assign-to-new-customer', {
        method: 'POST',
        body:   JSON.stringify(body),
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        // err.data carries the structured fields the wrapper sends back.
        setError((err.data as AssignErrorShape | null) ?? { error: err.message });
      } else {
        setError({ error: err instanceof Error ? err.message : 'Submission failed.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPaymentUrl() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.payment_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard API can fail in non-secure contexts */ }
  }

  const valid =
    customerEmail.trim().length > 3 &&
    customerEmail.includes('@') &&
    contactName.trim().length > 0 &&
    businessName.trim().length > 0 &&
    packageSlug.trim().length > 0;

  // ── Style tokens ─────────────────────────────────────────────────────
  // Inline styles use explicit tokens (not arbitrary hex) so they stay
  // in lockstep with the rest of the IDE's theme.
  const labelStyle: React.CSSProperties = {
    fontSize:      '0.8125rem',
    fontWeight:    600,
    color:         'var(--text-primary)',
    letterSpacing: '0.01em',
    display:       'block',
    marginBottom:  4,
  };
  const helpStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    color:    'var(--text-secondary)',
    marginTop: 4,
  };
  const inputStyle: React.CSSProperties = {
    width:        '100%',
    height:       36,
    padding:      '0 10px',
    background:   'var(--bg-base)',
    color:        'var(--text-primary)',
    border:       '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-field)',
    fontSize:     '0.875rem',
    fontFamily:   'inherit',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="abw-assign-customer-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          background:    'var(--bg-overlay)',
          color:         'var(--text-primary)',
          border:        '1px solid var(--border-strong)',
          borderRadius:  'var(--radius-card)',
          width:         '100%',
          maxWidth:      560,
          maxHeight:     '90vh',
          overflow:      'auto',
          boxShadow:     'var(--shadow-overlay)',
          display:       'flex',
          flexDirection: 'column',
          gap:           'var(--space-4)',
          padding:       'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <h2
            id="abw-assign-customer-title"
            style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}
          >
            Assign to new customer
          </h2>
          <button
            type="button"
            className="abw-btn abw-btn--ghost abw-btn--xs"
            onClick={onClose}
            aria-label="Close"
            style={{ color: 'var(--text-primary)' }}
          >
            ✕
          </button>
        </div>

        {!result && (
          <>
            <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.875rem', lineHeight: 1.5 }}>
              Creates a customer workspace in SignalPointSystems, generates a
              Stripe Checkout session for the chosen package, and puts{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{projectName}</strong> into
              pending-payment state. The site goes live when the customer pays.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <label>
                <span style={labelStyle}>Customer email *</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="owner@theircafe.com"
                  disabled={submitting}
                  style={inputStyle}
                />
              </label>

              <label>
                <span style={labelStyle}>Contact name *</span>
                <input
                  type="text"
                  required
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Sarah Johnson"
                  disabled={submitting}
                  style={inputStyle}
                />
              </label>

              <label>
                <span style={labelStyle}>Business name *</span>
                <input
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Maple Street Cafe"
                  disabled={submitting}
                  style={inputStyle}
                />
              </label>

              <label>
                <span style={labelStyle}>Package *</span>
                <select
                  required
                  value={packageSlug}
                  onChange={(e) => setPackageSlug(e.target.value)}
                  disabled={submitting || pickersLoading || packages.length === 0}
                  style={inputStyle}
                >
                  {pickersLoading ? (
                    <option value="">Loading packages…</option>
                  ) : packages.length === 0 ? (
                    <option value="">No packages available</option>
                  ) : (
                    packages.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.name} — {fmtPrice(p.monthly_price_cents)}
                      </option>
                    ))
                  )}
                </select>
                {packagesSource === 'fallback' && !pickersLoading && (
                  <span style={helpStyle}>
                    ⚠ Showing curated list (SignalPointSystems didn't return a packages
                    catalog yet). Slug is sent verbatim — make sure SPS has a matching offer
                    in <code>offer_packages</code>.
                  </span>
                )}
              </label>

              <label>
                <span style={labelStyle}>
                  Niche <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional)</span>
                </span>
                <select
                  value={nicheSlug}
                  onChange={(e) => setNicheSlug(e.target.value)}
                  disabled={submitting || pickersLoading}
                  style={inputStyle}
                >
                  <option value="">— No niche —</option>
                  {niches.map((n) => (
                    <option key={n.slug} value={n.slug}>
                      {n.label}
                    </option>
                  ))}
                </select>
                <span style={helpStyle}>
                  Helps SPS tag the customer for analytics + suggests matching
                  templates if you add more sites later.
                </span>
              </label>

              {error && (
                <div
                  role="alert"
                  style={{
                    background:    'rgba(220, 38, 38, 0.10)',
                    border:        '1px solid rgba(220, 38, 38, 0.40)',
                    borderRadius:  'var(--radius-field)',
                    padding:       'var(--space-3)',
                    color:         '#fca5a5',
                    fontSize:      '0.8125rem',
                    display:       'flex',
                    flexDirection: 'column',
                    gap:           6,
                  }}
                >
                  <strong style={{ color: '#fecaca' }}>Couldn't assign customer.</strong>
                  <div><span style={{ color: '#fecaca' }}>Reason:</span> {error.error ?? 'Unknown'}</div>
                  {error.message && <div>{error.message}</div>}
                  {error.warning && <div>{error.warning}</div>}
                  {error.hint && (
                    <div style={{ color: '#fde68a' }}>
                      <span style={{ color: '#fcd34d' }}>Hint:</span> {error.hint}
                    </div>
                  )}
                  {error.sps_status != null && (
                    <div style={{ color: 'var(--text-secondary)' }}>
                      SPS HTTP {error.sps_status}
                      {error.sps_content_type ? ` · ${error.sps_content_type}` : ''}
                    </div>
                  )}
                  {(error.sps_body_preview ?? error.sps_body) && (
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ cursor: 'pointer', color: '#fecaca' }}>
                        Response body preview
                      </summary>
                      <pre style={{
                        margin:       '4px 0 0',
                        padding:      'var(--space-2)',
                        background:   'rgba(0,0,0,0.4)',
                        borderRadius: 4,
                        fontSize:     '0.7rem',
                        color:        'var(--text-secondary)',
                        whiteSpace:   'pre-wrap',
                        wordBreak:    'break-word',
                        maxHeight:    160,
                        overflow:     'auto',
                      }}>{error.sps_body_preview ?? error.sps_body}</pre>
                    </details>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="abw-btn abw-btn--ghost"
                  onClick={onClose}
                  disabled={submitting}
                  style={{ color: 'var(--text-primary)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="abw-btn abw-btn--primary"
                  disabled={!valid || submitting}
                >
                  {submitting ? 'Submitting…' : 'Send invoice to customer'}
                </button>
              </div>
            </form>
          </>
        )}

        {result && (
          <>
            <div
              role="status"
              style={{
                background:    'rgba(34, 197, 94, 0.10)',
                border:        '1px solid rgba(34, 197, 94, 0.40)',
                borderRadius:  'var(--radius-field)',
                padding:       'var(--space-3)',
                color:         '#86efac',
                fontSize:      '0.875rem',
                display:       'flex',
                flexDirection: 'column',
                gap:           4,
              }}
            >
              <strong style={{ color: '#bbf7d0' }}>Invoice sent.</strong>
              <span>{customerEmail} can now pay via Stripe Checkout. The site goes live automatically once payment completes.</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span style={labelStyle}>Stripe Checkout URL</span>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch' }}>
                <input
                  readOnly
                  value={result.payment_url}
                  style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: '0.8125rem' }}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" className="abw-btn abw-btn--secondary" onClick={copyPaymentUrl}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <a
                  className="abw-btn abw-btn--secondary"
                  href={result.payment_url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open
                </a>
              </div>
            </div>

            <details style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-primary)' }}>SPS identifiers (for support)</summary>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                marginTop: 'var(--space-2)',
                fontFamily: 'monospace', fontSize: '0.75rem',
                color: 'var(--text-secondary)',
              }}>
                <span>workspace_id: {result.workspace_id}</span>
                <span>organization_id: {result.organization_id}</span>
                <span>customer_website_id: {result.customer_website_id}</span>
                <span>stripe_session_id: {result.stripe_session_id}</span>
                <span>pending_until: {result.pending_until}</span>
              </div>
            </details>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="abw-btn abw-btn--primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
