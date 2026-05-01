// apps/api/src/lib/emailRenderer.ts — table-based HTML email builder.
// Gmail-, Outlook-, and Apple Mail-compatible. All CSS is inline (no <style>).
//
// Input is a constrained "safe" body HTML (<p><h2><h3><ul><li><strong><em><a>),
// NOT full HTML. The builder wraps it in a 600px table layout per style.

export type EmailStyle =
  | 'newsletter'
  | 'welcome'
  | 'promotional'
  | 'transactional'
  | 'announcement';

export interface EmailTemplate {
  style:       EmailStyle;
  subject:     string;
  previewText: string;
  bodyHtml:    string;          // already sanitized to safe tags
  fromName?:   string;
  footer?:     string;
}

interface StylePalette {
  bg:        string;
  container: string;
  accent:    string;
  text:      string;
  muted:     string;
  font:      string;
}

const PALETTES: Record<EmailStyle, StylePalette> = {
  newsletter:    { bg: '#f6f7fb', container: '#ffffff', accent: '#5b6ef5', text: '#1a1a2e', muted: '#6b7280', font: 'Arial, Helvetica, sans-serif' },
  welcome:       { bg: '#ecfdf5', container: '#ffffff', accent: '#059669', text: '#064e3b', muted: '#6b7280', font: 'Arial, Helvetica, sans-serif' },
  promotional:   { bg: '#fef3c7', container: '#ffffff', accent: '#ea580c', text: '#431407', muted: '#78716c', font: 'Helvetica, Arial, sans-serif' },
  transactional: { bg: '#f8fafc', container: '#ffffff', accent: '#0f172a', text: '#0f172a', muted: '#64748b', font: 'Arial, Helvetica, sans-serif' },
  announcement:  { bg: '#1a1a2e', container: '#2d2d44', accent: '#f59e0b', text: '#f8fafc', muted: '#cbd5e1', font: 'Georgia, serif'                },
};

function inline(style: Record<string, string>): string {
  return Object.entries(style).map(([k, v]) => `${k}:${v}`).join(';');
}

/** Compose the final HTML email from a sanitized body. */
export function buildEmailHtml(t: EmailTemplate): string {
  const p = PALETTES[t.style];
  const fromLine = t.fromName ? `<div style="${inline({ color: p.muted, 'font-size': '13px', 'margin-bottom': '12px' })}">From ${escapeHtml(t.fromName)}</div>` : '';
  const footer = t.footer ? `<tr><td style="${inline({ padding: '24px 32px', 'border-top': `1px solid ${p.muted}33`, color: p.muted, 'font-size': '12px', 'text-align': 'center' })}">${escapeHtml(t.footer)}</td></tr>` : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(t.subject)}</title>
</head>
<body style="${inline({ margin: '0', padding: '0', background: p.bg, 'font-family': p.font, color: p.text })}">
<!-- Preview text (hidden) -->
<div style="${inline({ display: 'none', 'max-height': '0px', overflow: 'hidden' })}">${escapeHtml(t.previewText)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${inline({ background: p.bg, padding: '32px 0' })}">
<tr>
<td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="${inline({ 'max-width': '600px', width: '100%', background: p.container, 'border-radius': '8px', overflow: 'hidden' })}">
    <tr>
      <td style="${inline({ padding: '32px', 'border-top': `4px solid ${p.accent}` })}">
        ${fromLine}
        <div style="${inline({ 'font-size': '16px', 'line-height': '1.6', color: p.text })}">
          ${t.bodyHtml}
        </div>
      </td>
    </tr>
    ${footer}
  </table>
</td>
</tr>
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
