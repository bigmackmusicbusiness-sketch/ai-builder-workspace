// apps/web/src/screens/EmailComposerScreen.tsx — split-panel email composer.
// Left: prompt + style pills + from/footer. Right: iframe preview (desktop|mobile).
// Action bar: Send Test · Download · Copy HTML.
import { useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';

type EmailStyle = 'newsletter' | 'welcome' | 'promotional' | 'transactional' | 'announcement';
type Viewport   = 'desktop' | 'mobile';

const STYLES: { id: EmailStyle; label: string; description: string }[] = [
  { id: 'newsletter',    label: 'Newsletter',    description: 'Editorial, warm' },
  { id: 'welcome',       label: 'Welcome',       description: 'Friendly, clear next step' },
  { id: 'promotional',   label: 'Promotional',   description: 'Benefit-first, one CTA' },
  { id: 'transactional', label: 'Transactional', description: 'Terse, factual' },
  { id: 'announcement',  label: 'Announcement',  description: 'Confident, dark header' },
];

interface ComposeResult {
  subject:     string;
  previewText: string;
  bodyHtml:    string;
  fullHtml:    string;
}

export function EmailComposerScreen(): JSX.Element {
  const [prompt, setPrompt]       = useState('');
  const [style, setStyle]         = useState<EmailStyle>('newsletter');
  const [fromName, setFromName]   = useState('');
  const [footer, setFooter]       = useState('');
  const [expanded, setExpanded]   = useState(false);

  const [generating, setGenerating] = useState(false);
  const [result, setResult]         = useState<ComposeResult | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [copied, setCopied]         = useState(false);

  const [viewport, setViewport]     = useState<Viewport>('desktop');

  // Send-test dialog
  const [showSend, setShowSend]     = useState(false);
  const [sendProvider, setSendProvider] = useState<'resend' | 'sendgrid'>('resend');
  const [toEmail, setToEmail]       = useState('');
  const [fromEmail, setFromEmail]   = useState('');
  const [sending, setSending]       = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);

  async function handleCompose() {
    if (!prompt.trim()) { setError('Describe what the email should say.'); return; }
    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const res = await apiFetch<ComposeResult>('/api/email/compose', {
        method: 'POST',
        body:   JSON.stringify({
          prompt,
          style,
          fromName: fromName || undefined,
          footer:   footer   || undefined,
        }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Compose failed.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!result?.fullHtml) return;
    await navigator.clipboard.writeText(result.fullHtml);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handleDownload() {
    if (!result?.fullHtml) return;
    const blob = new Blob([result.fullHtml], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${result.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'email'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSendTest(e: React.FormEvent) {
    e.preventDefault();
    if (!result) return;
    if (!toEmail.trim() || !fromEmail.trim()) { setSendStatus('Both email fields required.'); return; }
    setSending(true);
    setSendStatus(null);
    try {
      await apiFetch('/api/email/send-test', {
        method: 'POST',
        body:   JSON.stringify({
          provider: sendProvider,
          toEmail,
          fromEmail,
          subject:  result.subject,
          html:     result.fullHtml,
          previewText: result.previewText,
        }),
      });
      setSendStatus('✓ Sent successfully.');
    } catch (err) {
      setSendStatus(err instanceof ApiError ? err.message : 'Send failed.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="abw-screen" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {error && (
        <div className="abw-banner abw-banner--warning" style={{ marginBottom: 'var(--space-4)' }}>
          ⚠ {error}
          <button className="abw-btn abw-btn--ghost abw-btn--xs" style={{ marginLeft: 'auto' }} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Email Composer</h1>
          <p className="abw-screen__sub">Write, preview, and send test emails through Resend or SendGrid.</p>
        </div>
      </div>

      {/* Split panel */}
      <div style={{
        display:       'grid',
        gridTemplateColumns: 'minmax(320px, 420px) 1fr',
        gap:           'var(--space-4)',
        flex:          1,
        minHeight:     0,
      }}>
        {/* Left: prompt + controls */}
        <div className="abw-card" style={{ padding: 'var(--space-4)', overflowY: 'auto' }}>
          <label className="abw-field">
            <span className="abw-field__label">Brief *</span>
            <textarea
              className="abw-input"
              rows={6}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should this email say? Include the goal, audience, and the one action you want them to take."
            />
          </label>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Style</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyle(s.id)}
                  className={`abw-btn abw-btn--ghost abw-btn--sm${style === s.id ? ' abw-btn--secondary' : ''}`}
                  style={{ borderColor: style === s.id ? 'var(--accent-500)' : 'var(--border-base)' }}
                  title={s.description}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional sender + footer */}
          <button
            type="button"
            className="abw-btn abw-btn--ghost abw-btn--sm"
            style={{ marginTop: 'var(--space-4)' }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▾' : '▸'} Sender &amp; footer
          </button>
          {expanded && (
            <div style={{ marginTop: 'var(--space-3)', display: 'grid', gap: 'var(--space-3)' }}>
              <label className="abw-field">
                <span className="abw-field__label">From name</span>
                <input className="abw-input" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Acme Inc." />
              </label>
              <label className="abw-field">
                <span className="abw-field__label">Footer text</span>
                <input className="abw-input" value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Acme Inc · 123 Main St · Unsubscribe" />
              </label>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)' }}>
            <button
              type="button"
              className="abw-btn abw-btn--primary"
              onClick={() => void handleCompose()}
              disabled={generating}
            >
              {generating ? 'Composing…' : '✨ Generate'}
            </button>
            {result && (
              <button type="button" className="abw-btn abw-btn--ghost" onClick={() => setResult(null)} disabled={generating}>
                Clear
              </button>
            )}
          </div>

          {result && (
            <div style={{ marginTop: 'var(--space-5)', padding: 'var(--space-3)', background: 'var(--surface-base)', borderRadius: 'var(--radius-field)' }}>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Subject</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{result.subject}</div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 'var(--space-2)' }}>Preview</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{result.previewText}</div>
            </div>
          )}
        </div>

        {/* Right: iframe preview */}
        <div className="abw-card" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-3)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <div style={{ display: 'flex', border: '1px solid var(--border-base)', borderRadius: 'var(--radius-field)', overflow: 'hidden' }}>
              {(['desktop', 'mobile'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`abw-btn abw-btn--ghost abw-btn--sm${viewport === v ? ' abw-btn--secondary' : ''}`}
                  onClick={() => setViewport(v)}
                  style={{ border: 'none', borderRadius: 0 }}
                  aria-pressed={viewport === v}
                >
                  {v === 'desktop' ? '🖥 Desktop' : '📱 Mobile'}
                </button>
              ))}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
              <button
                type="button"
                className="abw-btn abw-btn--ghost abw-btn--sm"
                disabled={!result}
                onClick={() => void handleCopy()}
              >
                {copied ? '✓ Copied' : '⎘ Copy HTML'}
              </button>
              <button
                type="button"
                className="abw-btn abw-btn--ghost abw-btn--sm"
                disabled={!result}
                onClick={handleDownload}
              >
                ↓ Download
              </button>
              <button
                type="button"
                className="abw-btn abw-btn--primary abw-btn--sm"
                disabled={!result}
                onClick={() => setShowSend(true)}
              >
                ✉ Send test
              </button>
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', background: 'var(--surface-base)', borderRadius: 'var(--radius-field)', overflow: 'auto', padding: 'var(--space-3)' }}>
            {result ? (
              <iframe
                title="Email preview"
                srcDoc={result.fullHtml}
                style={{
                  width:        viewport === 'desktop' ? 640 : 390,
                  maxWidth:     '100%',
                  height:       '100%',
                  minHeight:    560,
                  border:       '1px solid var(--border-base)',
                  borderRadius: '4px',
                  background:   '#fff',
                }}
              />
            ) : (
              <div className="abw-empty-state" style={{ margin: 'auto' }}>
                <span className="abw-empty-state__icon" aria-hidden>✉</span>
                <p className="abw-empty-state__label">No email yet</p>
                <p className="abw-empty-state__sub">Describe your email on the left and click Generate.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Send test dialog */}
      {showSend && result && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-test-title"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, padding: 'var(--space-4)',
          }}
          onClick={() => !sending && setShowSend(false)}
        >
          <form
            onSubmit={(e) => void handleSendTest(e)}
            className="abw-card"
            style={{ padding: 'var(--space-5)', width: '100%', maxWidth: 440 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="send-test-title" style={{ marginTop: 0, fontSize: '1.125rem' }}>Send test email</h2>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              {(['resend', 'sendgrid'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`abw-btn abw-btn--ghost abw-btn--sm${sendProvider === p ? ' abw-btn--secondary' : ''}`}
                  onClick={() => setSendProvider(p)}
                >
                  {p === 'resend' ? 'Resend' : 'SendGrid'}
                </button>
              ))}
            </div>
            <label className="abw-field" style={{ marginTop: 'var(--space-2)' }}>
              <span className="abw-field__label">From (verified sender)</span>
              <input className="abw-input" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="sender@yourdomain.com" required />
            </label>
            <label className="abw-field" style={{ marginTop: 'var(--space-2)' }}>
              <span className="abw-field__label">To</span>
              <input className="abw-input" type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="you@example.com" required />
            </label>
            {sendStatus && (
              <div style={{
                marginTop: 'var(--space-3)',
                padding:   'var(--space-2) var(--space-3)',
                background: sendStatus.startsWith('✓') ? 'var(--success-500)22' : 'var(--error-500)22',
                color:      sendStatus.startsWith('✓') ? 'var(--success-500)'   : 'var(--error-500)',
                borderRadius: 'var(--radius-field)', fontSize: '0.875rem',
              }}>
                {sendStatus}
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
              <button type="submit" className="abw-btn abw-btn--primary" disabled={sending}>
                {sending ? 'Sending…' : 'Send'}
              </button>
              <button type="button" className="abw-btn abw-btn--ghost" onClick={() => setShowSend(false)} disabled={sending}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
