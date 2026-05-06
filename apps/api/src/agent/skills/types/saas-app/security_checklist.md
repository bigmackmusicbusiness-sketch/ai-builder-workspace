# Security checklist — SaaS app

This is a multi-tenant SaaS, often with Stripe or another payment provider.
Verify every item below is reflected in the code you produce. Where the
runtime depends on env vars or platform config, write the placeholder code
so it works once the operator sets the var.

## Auth & sessions
- [ ] Sessions live in `httpOnly; Secure; SameSite=Lax` cookies, NEVER `localStorage` (vulnerable to XSS exfil).
- [ ] Session ID is rotated on login (regenerate ID after successful auth) to prevent session-fixation.
- [ ] Password reset uses a single-use, time-limited token (≤ 30 min) bound to the user, sent via email.
- [ ] Login endpoint returns the same generic "invalid credentials" error whether the email exists or not (no user enumeration).
- [ ] Passwords are hashed with **bcrypt cost 12+** or **argon2id**, never SHA/MD5/plaintext.
- [ ] 2FA support via TOTP or WebAuthn, even if optional. Store TOTP secrets encrypted.

## Multi-tenancy
- [ ] EVERY DB query filters by `tenant_id` from the session, NOT from URL/body params.
  - ✅ `WHERE id = $1 AND tenant_id = $2` (with tenant_id from session)
  - ❌ `WHERE id = $1` alone — IDOR.
- [ ] User-uploaded files stored at tenant-scoped paths (`tenants/<tid>/uploads/...`) with access checks on every read.
- [ ] Database has Row-Level Security policies as a backstop, not as the only line of defense.
- [ ] Cross-tenant invitations require explicit acceptance — never auto-attach a user to an org from a URL.

## Stripe / payments
- [ ] `STRIPE_SECRET_KEY` is server-side-only — NEVER in `VITE_*` env or client bundle.
- [ ] Card data goes through Stripe Checkout or Elements. Your server NEVER sees the PAN.
- [ ] Webhooks verified with `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)` — reject anything that doesn't validate.
- [ ] Webhook handler is idempotent (use Stripe's `event.id` as a dedup key) so retries don't double-charge.
- [ ] Prices computed server-side from a price catalog. Never trust an `amount` field from the client.
- [ ] PCI-scope reduction: don't log full card numbers, CVV, or full expiry.

## API surface
- [ ] Per-tenant rate limits on all `/api/*` mutating routes (suggest 60 req/min/user; tighter on auth-adjacent endpoints).
- [ ] Input validation via Zod / Joi on every POST/PATCH; reject unknown fields.
- [ ] CSRF protection: require `X-Requested-With: fetch` header on cookie-authed mutations OR a CSRF token (double-submit cookie).
- [ ] CORS allowlist matches your actual domains. Don't `*` if cookies are involved.

## Data & logs
- [ ] PII (email, phone, name) never appears in URL paths or query strings — referrer leaks.
- [ ] Logs scrub PII at the edge (mask emails as `j***@d***`, last-4 of phone).
- [ ] Soft-delete user records (set `deleted_at`); enable a real GDPR/CCPA delete endpoint behind admin role.
- [ ] Backups encrypted at rest. Database connection over TLS.

## Headers (set on every HTML response)
- [ ] `Content-Security-Policy` (start with `default-src 'self'`; add `https://js.stripe.com` for Stripe.js).
- [ ] `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- [ ] `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.

If you're producing a static landing-page surface only (no auth, no payments),
the bullets in **Auth & sessions**, **Multi-tenancy**, and **Stripe** still
apply the moment those features ship. Bake the structure now.
