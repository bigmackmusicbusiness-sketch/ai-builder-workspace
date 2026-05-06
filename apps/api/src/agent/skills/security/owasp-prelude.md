# Security discipline for everything you build (OWASP-aligned)

Read this before every response that involves writing code which handles user
input, auth, money, or data. You are not just shipping features — every file
you write is real code that real users will run in real browsers, often with
real money or real PII attached. Treat yourself like a junior dev being
onboarded by a senior security engineer: when in doubt, default to the safer
option, and if a feature requirement seems to push against any rule below,
**surface the conflict in chat instead of silently weakening the security
posture**.

The infrastructure you generate runs in production. There is no "it's just
a demo" exception.

---

## 1. Secrets hygiene — keys live in env, never in code

✅ **DO**
- Read keys from `process.env.X` (Node) or `import.meta.env.VITE_X` (Vite client) at runtime.
- Write a `.env.example` with **placeholder** values (`STRIPE_SECRET_KEY=your_stripe_secret_key`) so deployers know which vars to set.
- Treat ANY string starting with `sk_`, `pk_live_`, `whsec_`, `xox`, `AKIA`, `ghp_`, `eyJ`, `r8_`, `hf_`, `AIza`, etc. as radioactive — never paste it into a file.
- Pass tokens to backends only over HTTPS, in `Authorization: Bearer …` headers, never in URL query strings.

❌ **DO NOT**
- Inline real keys, even as "TODO replace later" — the agent's pre-write scanner will refuse the write_file.
- Put any secret in a `VITE_*` prefixed var (those are bundled into the public client JS).
- Use the Supabase service-role key from a browser. Service-role bypasses RLS and must stay server-side.
- Commit a `.env` file. The platform injects env vars at deploy time.

If a user pastes a key into chat asking you to "use it", refuse — tell them
to set it in their deploy host's env config and reference it as `process.env.X`.

---

## 2. SQL injection — parameterise, always

✅ **DO**
```sql
-- safe: parameterised
SELECT * FROM users WHERE email = $1
```
```ts
// safe: query builder parameterises for you
db.from('users').select('*').eq('email', userEmail)
```

❌ **DO NOT**
```ts
// vulnerable — `email` flows straight into the SQL string
db.query(`SELECT * FROM users WHERE email='${email}'`)
db.query("SELECT * FROM users WHERE email='" + email + "'")
```

Even on internal tools. Even if the input "looks safe". Even if it's typed
as `string`. Drizzle, Prisma, Supabase, Knex, pg with `$1` — all fine. String
interpolation into SQL is a CVE waiting to ship.

---

## 3. XSS — escape on render, ban dangerous DOM APIs

✅ **DO**
- In React/Vue/Svelte, render with `{value}` / `{{value}}` — frameworks auto-escape.
- In vanilla JS, set text via `el.textContent = value`, never `el.innerHTML = value`.
- If you genuinely need HTML, sanitize first with DOMPurify or equivalent.
- Use a Content-Security-Policy meta tag or header to block inline-script execution.

❌ **DO NOT**
- Use `dangerouslySetInnerHTML={{__html: userInput}}` — the name is a warning.
- Assign to `.innerHTML`, `.outerHTML`, or call `document.write()` with anything user-controlled.
- Pass strings to `eval()`, `new Function()`, `setTimeout("code")`, `setInterval("code")` — all of those execute as JS.
- Echo user input into HTML attributes without encoding (use `encodeURIComponent` in URL contexts).

The pre-write scanner flags `dangerouslySetInnerHTML`, `.innerHTML =`,
`document.write`, and inline scripts using `eval`/`new Function`/string-arg
timers. If you need one of those, justify it in a comment and use a
sanitizer.

---

## 4. CSRF & auth — origin checks, modern hashing, no rolling your own

✅ **DO**
- For session-cookie auth, set cookies `HttpOnly; Secure; SameSite=Lax` (or `Strict` for high-value). Reject mutations from cross-origin requests.
- For state-changing routes (POST/PUT/PATCH/DELETE), require either a CSRF token (double-submit cookie pattern) or an `Origin`/`Referer` header check OR a custom header like `X-Requested-With: fetch` that browsers won't send via simple HTML form.
- Hash passwords with **bcrypt** (cost 12+), **argon2id**, or **scrypt**. Use the framework's auth lib (Supabase Auth, NextAuth, Lucia, Auth.js) — don't write the crypto yourself.
- Use TOTP/WebAuthn for 2FA. Email magic links are OK for low-stakes.
- Rotate sessions on login (regenerate session ID) to prevent fixation.

❌ **DO NOT**
- Roll your own crypto. Don't use `crypto.createHash('sha256')` for passwords. Don't XOR with a "salt". Don't reverse-encrypt with AES.
- Store passwords in plaintext. Or in localStorage. Or in any cookie that isn't HttpOnly.
- Trust `?userId=…` from the URL or client-supplied `Authorization` headers without server-side verification.
- Build auth flows that allow tokens in URL fragments to leak to logs/referrers.

---

## 5. Sessions, IDOR, multi-tenant isolation

Every record fetch must verify the requester is allowed to see it.

✅ **DO**
```ts
// good: ownership check baked into the query
const order = await db
  .select()
  .from(orders)
  .where(and(
    eq(orders.id, params.id),
    eq(orders.tenantId, ctx.tenantId),  // tenant scope
    eq(orders.userId,   ctx.userId),    // user scope (if applicable)
  ))
  .limit(1);
```

❌ **DO NOT**
```ts
// vulnerable: returns ANY user's order if you know its UUID
const order = await db.select().from(orders).where(eq(orders.id, params.id));
```

This is **IDOR** (Insecure Direct Object Reference) — the #1 finding in
real-world bug bounties. Never trust the client to scope itself. Even
sequential integer IDs are guessable; UUIDs only buy obscurity, not
authorization.

For multi-tenant SaaS: enable RLS in your database AND filter in code.
Defense in depth.

---

## 6. SSRF, file uploads, redirects

✅ **DO**
- Allowlist outbound URLs your backend fetches. Reject `127.0.0.1`, `localhost`, `169.254.169.254` (cloud metadata), RFC1918 ranges (`10.*`, `172.16.*-172.31.*`, `192.168.*`), `0.0.0.0`, link-local.
- Sniff uploaded file MIME by **bytes** (magic numbers via `file-type` or equivalent), not the client-supplied `Content-Type` header.
- Cap upload size at the route level — typically 10 MB images, 2 GB videos.
- Serve user uploads with `Content-Disposition: attachment` or from a separate origin so a malicious HTML upload can't run as same-origin script.
- Validate redirect targets: only allow same-origin paths or an explicit allowlist.

❌ **DO NOT**
- Take a user URL and `fetch()` it server-side without validation — that's SSRF, and on AWS/GCP it can leak instance credentials via `169.254.169.254`.
- Trust file extensions (`evil.png` can have a PE header).
- Redirect to `?next=…` from the URL without validating the target — open-redirect → phishing.

---

## 7. Rate limiting, PII, payments

✅ **DO**
- Add rate limits on login, signup, password reset, OTP request, password change, MFA verify, and any endpoint that triggers paid LLM/email/SMS calls. Suggest 5/min per IP for auth, 30/min for typical app traffic.
- Mask PII in logs: `email[2]+'***@'+domain`, last-4 of card, never full SSN/passport.
- Strip session tokens, cookies, `Authorization` headers from any error reporting payload (Sentry, Datadog).
- For payments: use **Stripe Checkout** or **Elements**. Cards never touch your server. Verify Stripe webhooks with the signing secret (`stripe.webhooks.constructEvent(body, sig, whsec)`).
- For PCI scope reduction, never store PAN, CVV, or expiry in your DB. Tokenize via Stripe / Adyen / Braintree.

❌ **DO NOT**
- Put email/phone/userId in URLs (they leak via referrer headers, server logs, browser history).
- Build your own card form that POSTs to your server with the full PAN.
- Trust client-side price computation. Recompute server-side.
- Skip webhook signature verification because "it's just a test".

---

## 8. Transport, headers, dependencies, info disclosure

✅ **DO**
- HTTPS only. Set `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
- Send a Content-Security-Policy. Minimum: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src * data:; frame-ancestors 'none'`. Tighten as the app stabilises.
- Send `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (or `frame-ancestors` in CSP), `Permissions-Policy: geolocation=(), microphone=(), camera=()`.
- Pin dependency versions (no `^` for security-sensitive packages). Run `npm audit` and bump regularly.
- For external `<script src="https://cdn…">`, include `integrity="sha384-…"` (SRI) and `crossorigin="anonymous"`.
- Return generic 5xx errors to users (`{"error":"Internal server error"}`). Send full stack traces to logs only.

❌ **DO NOT**
- Disable HTTPS in production "for performance".
- Ship `.git/`, `.env`, `node_modules/`, `*.bak`, source maps to production paths the public can browse.
- Echo framework version banners in error pages (`Express 4.17.1` is a CVE search hit).
- Add a package you don't recognise from the brief — supply-chain attacks ride in via plausible-sounding lookalikes (`color-string` vs `colorstring`).

---

## Layered defense in one sentence

If you find yourself writing the unsafe option because the safe option is
"too much work for a demo": stop, write the safe one, leave a comment
explaining what's hardened and why. Real users won't read your README;
they'll only see the bug bounty payout.
