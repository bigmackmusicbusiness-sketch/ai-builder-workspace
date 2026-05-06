# Security checklist — Internal tool

Internal tools run with privileged access (database queries, admin actions,
billing changes, user impersonation). The blast radius of a compromise is
much larger than a public site. Most of the items below assume the user
is staff/admin — but enforce as if every action will be audited.

## Access control
- [ ] Tool is gated by SSO (Google Workspace, Okta, Azure AD). No "type a password" auth.
- [ ] Per-action role check: viewing user data ≠ refunding payments ≠ deleting accounts. Define separate roles.
- [ ] Sensitive actions (refund, account-merge, mass-email, data export) require step-up auth: re-enter password / TOTP within last 5 min.
- [ ] IP allowlist for the entire tool — restrict to office VPN / known egress.
- [ ] Sessions expire after 4 hours of inactivity. No "keep me logged in" for admin tools.

## Audit logging is non-negotiable
- [ ] Every privileged action writes an audit row: `{actor_id, action, target_table, target_id, before, after, ip, user_agent, ts}`.
- [ ] Audit log is append-only; no DELETE / UPDATE permission for the app's DB role.
- [ ] Sensitive fields stored as hashes, not plaintext (e.g., before/after of user_email → SHA-256).
- [ ] Audit log retention: minimum 1 year for compliance, longer if regulated.
- [ ] Daily dashboard of unusual activity (refunds outside business hours, mass-export of users, role changes).

## Privileged data display
- [ ] PII fields masked by default in lists; click-to-reveal logged separately.
- [ ] Card numbers, SSNs, tokens NEVER displayed in plain — only last-4.
- [ ] User search rate-limited (no bulk scrape via `?q=a*`).
- [ ] When impersonating a user, the UI shows a persistent banner ("Acting as: Alice") and clicking through writes audit rows.

## Forms that mutate
- [ ] Confirmation dialog with the destructive action's name typed back ("Type DELETE to confirm").
- [ ] CSRF token on every form POST.
- [ ] No `delete` / `refund` / `mass-update` actions via GET — those can be triggered by image tags / link prefetching.
- [ ] Idempotency keys on bulk operations so accidental retries don't double-act.

## SQL console / query tools
- [ ] If the tool exposes a query console, restrict it to read-only role (`pg_role: readonly`).
- [ ] Force `EXPLAIN` before `SELECT` for queries that scan unbounded rows.
- [ ] Maximum row return cap (e.g., 10,000) to prevent OOM on `SELECT * FROM events`.
- [ ] Block `pg_*` system tables, information_schema queries that leak structure.

## Secrets & integrations
- [ ] API keys for downstream services (Stripe, Twilio, etc.) are server-side only.
- [ ] Operators NEVER see raw secrets — UI shows last-4 + rotation date.
- [ ] Rotation: secrets re-keyed every 90 days; old keys revoked immediately on rotation.

## Network / deployment
- [ ] Internal-only DNS — tool is not on the public internet.
- [ ] Behind WAF / Cloudflare with strict rate limiting.
- [ ] HSTS preload, CSP `default-src 'self'`, X-Frame-Options DENY.

If this tool can act on customer accounts, treat every action as if a
journalist will FOIA the audit log. Build accordingly.
