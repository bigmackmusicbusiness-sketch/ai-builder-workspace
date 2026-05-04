# Email composer type SOP — runtime rules for executor + polish

This SOP applies to projects of type `email-composer`. HTML emails sent via
Resend or SendGrid. Single-column layouts with inline CSS, compliance footer,
graceful fallback to plain text.

## File layout

```
template.html             # the HTML email, all CSS inline
template.txt              # plain-text fallback (auto-generated; verify content)
preview.html              # browser-only preview wrapped in a viewport
data/
  variables.json          # merge field defaults for preview
  recipients.example.csv  # sample recipient list (placeholder data)
send.config.json          # provider, from address, reply-to, subject, preheader
README.md
```

No build step. Pure HTML with inline CSS. Tailwind / external CSS is forbidden
(email clients strip it).

## Structural rules

- **Single-column** layout, max content width 600px
- Use `<table>`-based layout for Outlook compatibility:

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="center" style="padding: 24px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="max-width: 600px; width: 100%;">
        <tr><td>...content...</td></tr>
      </table>
    </td>
  </tr>
</table>
```

- All styles inline (`style="..."`); no `<style>` block in `<head>` for body styling
- Image widths set with both attribute (`width="600"`) and inline style
- Buttons are bulletproof (table-based, not styled `<a>`):

```html
<table role="presentation" cellspacing="0" cellpadding="0" border="0">
  <tr><td bgcolor="#0066ff" style="border-radius: 6px;">
    <a href="{{cta_url}}" target="_blank"
       style="display: inline-block; padding: 12px 24px; color: #ffffff;
              text-decoration: none; font-weight: 600;">
      {{cta_label}}
    </a>
  </td></tr>
</table>
```

## Required regions

Every email includes:

- **Preheader** — hidden 1-line preview text, shown in inbox row:

```html
<div style="display:none; max-height:0; overflow:hidden;">
  {{preheader}}
</div>
```

- **Header** — logo or brand mark, ≤ 60px tall
- **Body** — single column, headline + paragraphs + CTA
- **Footer** — physical address + unsubscribe + preference center link

## Compliance footer (mandatory)

Every email includes (CAN-SPAM + GDPR baseline):

```html
<p style="font-size:12px; color:#888; line-height:1.5;">
  You're receiving this because {{reason_user_subscribed}}.
  <a href="{{unsubscribe_url}}">Unsubscribe</a> ·
  <a href="{{preferences_url}}">Update preferences</a><br/>
  {{company_name}}, {{company_postal_address}}
</p>
```

Hard rules:

- The unsubscribe link is a **single-click** unsubscribe (no login required)
- The physical mailing address is a real postal address (not a PO box for some jurisdictions; check brief)
- The "from" name + reply-to are real and monitored
- The subject line is not deceptive

## Merge fields

Use double-curly Mustache-style fields: `{{first_name}}`, `{{cta_url}}`. Provider
templates render them server-side. Sanitize all merged values to prevent
HTML injection from CSV import.

## Plain-text fallback

`template.txt` mirrors the HTML's content. Required because:

- Some clients show only the text part
- Spam filters score domains worse if there's no text/plain part
- Accessibility tools rely on it

Auto-generate from HTML, then humanize it (link URLs spelled out, headers
preserved as ALL-CAPS or `=====` underlines).

## Subject + preheader rules

- Subject ≤ 50 chars (most clients truncate at 60)
- Preheader 60–100 chars, complements subject (doesn't repeat it)
- No ALL CAPS in subjects
- No trigger words (FREE!!!, ACT NOW) — they hurt deliverability
- Emoji use is fine but cap at 1 per subject

## Provider config

`send.config.json`:

```json
{
  "provider": "resend",
  "from": { "name": "Halcyon", "email": "hello@updates.halcyon.com" },
  "replyTo": "support@halcyon.com",
  "subject": "Your archive is ready, {{first_name}}",
  "preheader": "We finished processing — preview the first reel inside.",
  "tags": [{ "name": "campaign", "value": "archive-ready" }]
}
```

The "from" address must use a domain with verified SPF, DKIM, and DMARC.

## Security rules (hard, enforced)

- **NEVER include real recipient PII in committed files.** `recipients.example.csv`
  uses placeholder data only
- **NEVER hardcode API keys** for Resend/SendGrid; provider creds come from env
- All merged user-supplied values are HTML-escaped
- No `<script>` tags (most clients strip them; some flag the email as malicious)
- No `<iframe>`, no remote-loaded forms
- All tracking pixels disclosed in privacy policy; honor "no tracking" preference
- Unsubscribe link MUST work without login and within 10 days per CAN-SPAM
- Don't send to recipients who haven't opted in (transactional emails are an exception, but require legitimate basis)

## Quality rules

- Test render in: Gmail, Outlook (desktop + web), Apple Mail, mobile Gmail/Mail
- Image alt text on every `<img>` (some clients block images by default)
- Fallback `bgcolor` attribute on table cells (Outlook ignores some CSS bg)
- Email size < 100KB (Gmail clips at 102KB)
- Body contrast ≥ 4.5:1
- Link list at top is fine but the primary CTA is a button, not a text link

## Tool surface

Phase B (executor): `read_file`, `write_file`, `gen_image` (header art,
optimized to web format)
Phase B' (humanizer): `humanize_doc` for body + subject
Phase C (polish): `read_file`, `write_file`, `email_lint` (inline CSS check,
size check, compliance check), `spam_score`
