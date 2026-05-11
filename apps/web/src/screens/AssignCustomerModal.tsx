// apps/web/src/screens/AssignCustomerModal.tsx — Round 8 Feature B SPA UI.
//
// Modal launched from the "Assign to new customer" button in PublishScreen
// header. Collects prospect details, POSTs to /api/abw/assign-to-new-customer,
// and on success surfaces the Stripe Checkout URL the rep needs to share
// with the customer.
//
// Persistence of pending-customer state across IDE reloads is deferred to a
// follow-up: when the rep re-opens the project, the banner should be
// rehydrated from /api/projects (after we add the four pending-* columns to
// that response). For now, the post-submit success state lives in component
// state — closes when the rep closes the modal or navigates away.

import { useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api';

export interface AssignCustomerModalProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

/** SPS response forwarded by ABW's /api/abw/assign-to-new-customer.
 *  Shape locked in HANDOFF_NOTES round-8 Feature B + SPS round-9. */
interface AssignResponse {
  ok:                   true;
  workspace_id:         string;
  organization_id:      string;
  customer_website_id:  string;
  payment_url:          string;
  stripe_session_id:    string;
  pending_until:        string;
}

const PACKAGE_HINT = 'e.g. starter, pro, enterprise (SPS validates server-side)';

export function AssignCustomerModal({ projectId, projectName, onClose }: AssignCustomerModalProps) {
  const [customerEmail, setCustomerEmail] = useState('');
  const [contactName,   setContactName]   = useState('');
  const [businessName,  setBusinessName]  = useState('');
  const [packageSlug,   setPackageSlug]   = useState('');
  const [nicheSlug,     setNicheSlug]     = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [result,     setResult]     = useState<AssignResponse | null>(null);
  const [copied,     setCopied]     = useState(false);

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
        // Surface the SPS reason transparently — the wrapper forwards SPS
        // body text on 502 sps_rejected via the `data` field; pull out
        // anything human-readable.
        const detail = err.data ? ` — ${JSON.stringify(err.data).slice(0, 240)}` : '';
        setError(`${err.message}${detail}`);
      } else {
        setError(err instanceof Error ? err.message : 'Submission failed.');
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
    } catch {
      /* Clipboard API can fail in non-secure contexts; user can still
       * click the link. Don't surface as an error. */
    }
  }

  const valid =
    customerEmail.trim().length > 3 &&
    customerEmail.includes('@') &&
    contactName.trim().length > 0 &&
    businessName.trim().length > 0 &&
    packageSlug.trim().length > 0;

  return (
    <div
      className="abw-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="abw-assign-customer-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div
        className="abw-modal"
        style={{
          background: 'var(--surface-1, #fff)',
          borderRadius: 8,
          width: '100%',
          maxWidth: 540,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
          padding: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <h2 id="abw-assign-customer-title" style={{ margin: 0, fontSize: '1.25rem', flex: 1 }}>
            Assign to new customer
          </h2>
          <button
            type="button"
            className="abw-btn abw-btn--ghost abw-btn--xs"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!result && (
          <>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Creates a customer workspace in SignalPointSystems, generates a
              Stripe Checkout session for the chosen package, and puts{' '}
              <strong>{projectName}</strong> into pending-payment state. The
              site goes live when the customer pays.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <label className="abw-field">
                <span className="abw-field__label">Customer email *</span>
                <input
                  className="abw-input"
                  type="email"
                  required
                  autoComplete="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="owner@theircafe.com"
                  disabled={submitting}
                />
              </label>

              <label className="abw-field">
                <span className="abw-field__label">Contact name *</span>
                <input
                  className="abw-input"
                  type="text"
                  required
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Sarah Johnson"
                  disabled={submitting}
                />
              </label>

              <label className="abw-field">
                <span className="abw-field__label">Business name *</span>
                <input
                  className="abw-input"
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Maple Street Cafe"
                  disabled={submitting}
                />
              </label>

              <label className="abw-field">
                <span className="abw-field__label">Package slug *</span>
                <input
                  className="abw-input"
                  type="text"
                  required
                  pattern="[a-z0-9_-]+"
                  value={packageSlug}
                  onChange={(e) => setPackageSlug(e.target.value)}
                  placeholder={PACKAGE_HINT}
                  disabled={submitting}
                />
                <span className="abw-field__hint" style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                  {PACKAGE_HINT}
                </span>
              </label>

              <label className="abw-field">
                <span className="abw-field__label">Niche slug (optional)</span>
                <input
                  className="abw-input"
                  type="text"
                  pattern="[a-z0-9_-]*"
                  value={nicheSlug}
                  onChange={(e) => setNicheSlug(e.target.value)}
                  placeholder="restaurant, retail, fitness…"
                  disabled={submitting}
                />
              </label>

              {error && (
                <div className="abw-banner abw-banner--error" role="alert">
                  <strong>Couldn't assign:</strong> {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="abw-btn abw-btn--ghost"
                  onClick={onClose}
                  disabled={submitting}
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
            <div className="abw-banner abw-banner--success" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <strong>Invoice sent.</strong> {customerEmail} can now pay via
              Stripe Checkout. The site goes live automatically once payment
              completes.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span className="abw-field__label">Stripe Checkout URL</span>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch' }}>
                <input
                  className="abw-input"
                  readOnly
                  value={result.payment_url}
                  style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem' }}
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

            <details style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <summary style={{ cursor: 'pointer' }}>SPS identifiers (for support)</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)', fontFamily: 'monospace', fontSize: '0.78rem' }}>
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
