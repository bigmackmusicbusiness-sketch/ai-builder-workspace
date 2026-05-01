// apps/web/src/screens/DocumentsScreen.tsx — Document Studio UI.
// Proposals, case studies, reports, invoices, pitch decks.
import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { useProjectStore } from '../lib/store/projectStore';
import { useAuthStore } from '../lib/store/authStore';

// ── Types ─────────────────────────────────────────────────────────────────────

type DocType = 'business_proposal' | 'case_study' | 'project_report' | 'invoice' | 'pitch_deck';
type Status  = 'generating' | 'ready' | 'failed';

interface DocRow {
  id:        string;
  title:     string;
  docType:   DocType;
  status:    Status;
  assetId:   string | null;
  error:     string | null;
  createdAt: string;
}

interface InvoiceItem { description: string; quantity: number; unitPrice: number }

const DOC_TYPES: { id: DocType; label: string; description: string }[] = [
  { id: 'business_proposal', label: 'Business Proposal', description: 'Executive summary, scope, pricing' },
  { id: 'case_study',        label: 'Case Study',        description: 'Client challenge → results' },
  { id: 'project_report',    label: 'Project Report',    description: 'Status, risks, next actions' },
  { id: 'invoice',           label: 'Invoice',           description: 'Line items, totals, no AI' },
  { id: 'pitch_deck',        label: 'Pitch Deck',        description: '8–12 slides, one per page' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  if (m < 2)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function docLabel(t: DocType): string {
  return DOC_TYPES.find((d) => d.id === t)?.label ?? t;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DocumentsScreen(): JSX.Element {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projectIdForApi  = currentProjectId === 'global' ? undefined : currentProjectId;

  const [docs, setDocs]       = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [showForm, setShowForm]   = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress]   = useState<string[]>([]);

  // Form state
  const [title, setTitle]       = useState('');
  const [docType, setDocType]   = useState<DocType>('business_proposal');
  const [prompt, setPrompt]     = useState('');

  // Invoice-specific
  const [invFrom, setInvFrom]     = useState({ name: '', email: '', address: '' });
  const [invTo, setInvTo]         = useState({ name: '', email: '', address: '' });
  const [invNumber, setInvNumber] = useState('INV-001');
  const [invDue, setInvDue]       = useState('');
  const [invTax, setInvTax]       = useState(0);
  const [invItems, setInvItems]   = useState<InvoiceItem[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [invNotes, setInvNotes]   = useState('');
  const [invCurrency, setInvCurrency] = useState('USD');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = projectIdForApi ? `/api/documents?projectId=${projectIdForApi}` : `/api/documents`;
    apiFetch<{ documents: DocRow[] }>(url)
      .then((r) => { if (!cancelled) setDocs(r.documents); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load documents.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectIdForApi]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    const token = useAuthStore.getState().session?.access_token;
    if (!token) { setError('Not signed in.'); return; }

    if (docType !== 'invoice' && !prompt.trim()) {
      setError('A prompt is required for AI-generated documents.');
      return;
    }
    if (docType === 'invoice' && (!invFrom.name || !invTo.name || invItems.length === 0)) {
      setError('Invoice requires From, To, and at least one line item.');
      return;
    }

    setGenerating(true);
    setError(null);
    setProgress([`Starting: "${title}" (${docLabel(docType)})`]);

    const payload: Record<string, unknown> = {
      title,
      docType,
      projectId: projectIdForApi,
    };
    if (docType === 'invoice') {
      payload.invoice = {
        from: invFrom,
        to:   invTo,
        number: invNumber,
        dueDate: invDue || undefined,
        taxPct:  invTax,
        items:   invItems.filter((i) => i.description.trim()),
        notes:   invNotes || undefined,
        currency: invCurrency,
      };
    } else {
      payload.prompt = prompt;
    }

    try {
      const res = await fetch(`${API_BASE}/api/documents/generate`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        throw new Error(body.error ?? 'Generation failed');
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const event = JSON.parse(raw) as { type: string; step?: string; error?: string };
            if (event.type === 'step') {
              setProgress((p) => [...p, `→ ${event.step}`]);
            } else if (event.type === 'done') {
              setProgress((p) => [...p, '✓ Done.']);
              const url = projectIdForApi ? `/api/documents?projectId=${projectIdForApi}` : `/api/documents`;
              const fresh = await apiFetch<{ documents: DocRow[] }>(url);
              setDocs(fresh.documents);
            } else if (event.type === 'error') {
              throw new Error(event.error ?? 'Generation failed');
            }
          } catch { /* malformed SSE line */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setProgress((p) => [...p, `✗ ${msg}`]);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this document?')) return;
    try {
      await apiFetch(`/api/documents/${id}`, { method: 'DELETE' });
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  function handleDownload(id: string) {
    const token = useAuthStore.getState().session?.access_token;
    fetch(`${API_BASE}/api/documents/${id}/download`, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .then((res) => {
        if (res.redirected) { window.open(res.url, '_blank'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Download failed'));
  }

  const sorted = useMemo(
    () => [...docs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [docs],
  );

  function updateItem(idx: number, patch: Partial<InvoiceItem>) {
    setInvItems((prev) => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }

  const invoiceTotal = useMemo(() => {
    const sub = invItems.reduce((t, i) => t + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
    return sub + sub * (invTax / 100);
  }, [invItems, invTax]);

  return (
    <div className="abw-screen">
      {error && (
        <div className="abw-banner abw-banner--warning" style={{ marginBottom: 'var(--space-4)' }}>
          ⚠ {error}
          <button className="abw-btn abw-btn--ghost abw-btn--xs" style={{ marginLeft: 'auto' }} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Documents</h1>
          <p className="abw-screen__sub">
            {loading ? 'Loading…'
              : docs.length === 0 ? 'Generate proposals, case studies, invoices, and pitch decks.'
              : `${docs.length} document${docs.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button className="abw-btn abw-btn--primary" onClick={() => setShowForm((v) => !v)} disabled={generating}>
          {showForm ? '✕ Close' : '+ New document'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={(e) => void handleGenerate(e)} className="abw-card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
          <label className="abw-field">
            <span className="abw-field__label">Title *</span>
            <input className="abw-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Q3 Partnership Proposal" required />
          </label>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Document type</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-2)' }}>
              {DOC_TYPES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDocType(d.id)}
                  className={`abw-btn abw-btn--ghost${docType === d.id ? ' abw-btn--secondary' : ''}`}
                  style={{
                    textAlign: 'left', padding: 'var(--space-3)', height: 'auto',
                    flexDirection: 'column', alignItems: 'flex-start',
                    borderColor: docType === d.id ? 'var(--accent-500)' : 'var(--border-base)',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{d.label}</span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{d.description}</span>
                </button>
              ))}
            </div>
          </div>

          {docType !== 'invoice' ? (
            <label className="abw-field" style={{ marginTop: 'var(--space-4)' }}>
              <span className="abw-field__label">Brief / context</span>
              <textarea
                className="abw-input"
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should this document say? Include client name, scope, dates, and any facts the AI must use."
              />
            </label>
          ) : (
            <div style={{ marginTop: 'var(--space-4)' }}>
              {/* Invoice form */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <fieldset style={{ border: '1px solid var(--border-base)', padding: 'var(--space-3)', borderRadius: 'var(--radius-field)' }}>
                  <legend style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0 var(--space-1)' }}>From</legend>
                  <input className="abw-input" placeholder="Your company" value={invFrom.name} onChange={(e) => setInvFrom({ ...invFrom, name: e.target.value })} />
                  <input className="abw-input" style={{ marginTop: 8 }} placeholder="you@company.com" value={invFrom.email} onChange={(e) => setInvFrom({ ...invFrom, email: e.target.value })} />
                  <textarea className="abw-input" style={{ marginTop: 8 }} rows={2} placeholder="Address" value={invFrom.address} onChange={(e) => setInvFrom({ ...invFrom, address: e.target.value })} />
                </fieldset>
                <fieldset style={{ border: '1px solid var(--border-base)', padding: 'var(--space-3)', borderRadius: 'var(--radius-field)' }}>
                  <legend style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0 var(--space-1)' }}>Bill to</legend>
                  <input className="abw-input" placeholder="Client name" value={invTo.name} onChange={(e) => setInvTo({ ...invTo, name: e.target.value })} />
                  <input className="abw-input" style={{ marginTop: 8 }} placeholder="client@company.com" value={invTo.email} onChange={(e) => setInvTo({ ...invTo, email: e.target.value })} />
                  <textarea className="abw-input" style={{ marginTop: 8 }} rows={2} placeholder="Address" value={invTo.address} onChange={(e) => setInvTo({ ...invTo, address: e.target.value })} />
                </fieldset>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                <label className="abw-field">
                  <span className="abw-field__label">Invoice #</span>
                  <input className="abw-input" value={invNumber} onChange={(e) => setInvNumber(e.target.value)} />
                </label>
                <label className="abw-field">
                  <span className="abw-field__label">Due date</span>
                  <input className="abw-input" type="date" value={invDue} onChange={(e) => setInvDue(e.target.value)} />
                </label>
                <label className="abw-field">
                  <span className="abw-field__label">Tax %</span>
                  <input className="abw-input" type="number" min={0} max={100} step={0.01} value={invTax} onChange={(e) => setInvTax(parseFloat(e.target.value) || 0)} />
                </label>
                <label className="abw-field">
                  <span className="abw-field__label">Currency</span>
                  <input className="abw-input" value={invCurrency} onChange={(e) => setInvCurrency(e.target.value.toUpperCase())} maxLength={4} />
                </label>
              </div>

              <div style={{ marginTop: 'var(--space-4)' }}>
                <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Line items</p>
                {invItems.map((it, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 120px 40px', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                    <input className="abw-input" placeholder="Description" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
                    <input className="abw-input" type="number" min={0} step={1} value={it.quantity} onChange={(e) => updateItem(i, { quantity: parseFloat(e.target.value) || 0 })} />
                    <input className="abw-input" type="number" min={0} step={0.01} value={it.unitPrice} onChange={(e) => updateItem(i, { unitPrice: parseFloat(e.target.value) || 0 })} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      {invCurrency} {(it.quantity * it.unitPrice).toFixed(2)}
                    </div>
                    <button
                      type="button"
                      className="abw-btn abw-btn--ghost abw-btn--xs"
                      onClick={() => setInvItems((prev) => prev.filter((_, j) => j !== i))}
                      disabled={invItems.length === 1}
                      aria-label="Remove line"
                    >✕</button>
                  </div>
                ))}
                <button
                  type="button"
                  className="abw-btn abw-btn--ghost abw-btn--sm"
                  onClick={() => setInvItems((p) => [...p, { description: '', quantity: 1, unitPrice: 0 }])}
                >
                  + Add line
                </button>
                <div style={{ textAlign: 'right', marginTop: 'var(--space-3)', fontWeight: 600 }}>
                  Total: {invCurrency} {invoiceTotal.toFixed(2)}
                </div>
              </div>

              <label className="abw-field" style={{ marginTop: 'var(--space-4)' }}>
                <span className="abw-field__label">Notes</span>
                <textarea className="abw-input" rows={2} value={invNotes} onChange={(e) => setInvNotes(e.target.value)} placeholder="Payment terms, thanks, etc." />
              </label>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)' }}>
            <button type="submit" className="abw-btn abw-btn--primary" disabled={generating}>
              {generating ? 'Generating…' : 'Generate document'}
            </button>
            <button type="button" className="abw-btn abw-btn--ghost" onClick={() => setShowForm(false)} disabled={generating}>
              Cancel
            </button>
          </div>

          {progress.length > 0 && (
            <div
              style={{
                marginTop: 'var(--space-4)', padding: 'var(--space-3)',
                background: 'var(--surface-base)', border: '1px solid var(--border-base)',
                borderRadius: 'var(--radius-field)', fontSize: '0.75rem', lineHeight: 1.6,
                maxHeight: 160, overflowY: 'auto', fontFamily: 'var(--font-mono, monospace)',
              }}
              aria-live="polite"
            >
              {progress.map((l, i) => (
                <div key={i} style={{ color: l.startsWith('✗') ? 'var(--error-500)' : 'var(--text-secondary)' }}>{l}</div>
              ))}
            </div>
          )}
        </form>
      )}

      {loading ? (
        <div className="abw-empty-state"><p className="abw-empty-state__sub">Loading documents…</p></div>
      ) : sorted.length === 0 ? (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>📄</span>
          <p className="abw-empty-state__label">No documents yet</p>
          <p className="abw-empty-state__sub">Generate a proposal, case study, invoice, or pitch deck.</p>
          {!showForm && <button className="abw-btn abw-btn--primary" onClick={() => setShowForm(true)}>+ New document</button>}
        </div>
      ) : (
        <div className="abw-table-wrap">
          <table className="abw-table" aria-label="Documents">
            <thead>
              <tr>
                <th>Title</th>
                <th style={{ width: 160 }}>Type</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 110 }}>Created</th>
                <th style={{ width: 180 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.id}>
                  <td><span className="abw-table__name" style={{ fontWeight: 600 }}>{d.title}</span></td>
                  <td><span className="abw-badge" style={{ fontSize: '0.625rem' }}>{docLabel(d.docType)}</span></td>
                  <td>
                    <span style={{
                      color: d.status === 'ready' ? 'var(--success-500)' : d.status === 'failed' ? 'var(--error-500)' : 'var(--accent-500)',
                      fontSize: '0.75rem', fontWeight: 600,
                    }}>● {d.status}</span>
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{relativeTime(d.createdAt)}</td>
                  <td>
                    <div className="abw-table__actions">
                      <button className="abw-btn abw-btn--ghost abw-btn--xs" disabled={!d.assetId} onClick={() => handleDownload(d.id)}>
                        Download
                      </button>
                      <button className="abw-btn abw-btn--ghost abw-btn--xs abw-btn--destructive" onClick={() => void handleDelete(d.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
