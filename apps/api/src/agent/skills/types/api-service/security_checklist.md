# Security checklist — API service

You are building a backend API. Clients (browsers, mobile apps, third parties)
send requests; you authenticate, validate, and respond with JSON. Apply
EVERY item below — APIs are the most common vector for data exfiltration.

## Authentication
- [ ] Every authenticated route verifies a JWT via `jose` / `jsonwebtoken` against the issuer's public key (or HMAC secret for symmetric tokens). Cache JWKS responses; don't fetch them per request.
- [ ] Bearer tokens come ONLY from `Authorization: Bearer …` header. Never accept tokens in query strings, request body, or cookies-without-CSRF-protection.
- [ ] Token expiry is short (15 min for access tokens). Use refresh tokens for long sessions, stored httpOnly+Secure+SameSite=Strict.
- [ ] Logout invalidates the refresh token server-side (token denylist or session-id revocation).
- [ ] Service-to-service auth uses mTLS, signed JWTs (with `aud` + `iss` checks), or HMAC — NEVER hardcoded API keys baked into the client.

## Authorization
- [ ] Every protected route enforces tenant + user scope: `WHERE tenant_id = $tid AND (user_id = $uid OR shared_with_user($uid))`.
- [ ] Admin endpoints check `role === 'admin'` from the verified JWT, NOT from a request param/header.
- [ ] Write a `requireRole(ctx, 'admin')` helper and call it in EVERY admin route. Don't reimplement the check inline.

## Input validation
- [ ] Zod / class-validator / Joi schema for every POST/PATCH/PUT body. Reject on unknown fields (`.strict()` in Zod).
- [ ] Path params validated as UUIDs / integer / regex, not raw strings. `req.params.id` straight into SQL is a CVE.
- [ ] Query string params likewise. Limit array/object sizes (max 100 items per filter, max 10 KB body).
- [ ] File uploads: enforce size cap, MIME whitelist (sniff bytes via `file-type`, don't trust Content-Type), filename sanitization.

## SQL & ORM safety
- [ ] All queries parameterized. NO template-string concatenation into SQL.
- [ ] Use the framework's query builder (Drizzle/Prisma/Knex/`pg` with `$1`).
- [ ] Avoid `raw()` queries; if necessary, parameterize and document the threat model.

## Rate limiting & abuse
- [ ] Global per-IP rate limit (`@fastify/rate-limit` or `express-rate-limit`).
- [ ] Stricter per-route limits on `/auth/login`, `/auth/signup`, `/auth/reset-password`, `/auth/verify-otp`: 5-10 req/min/IP.
- [ ] Per-tenant limits on expensive endpoints (LLM calls, email sends, SMS sends).
- [ ] Return `429 Too Many Requests` with `Retry-After` header. Don't crash silently.

## Webhooks
- [ ] Inbound webhooks (Stripe, GitHub, Slack, etc.) verify HMAC signatures with the provider's signing secret. Reject mismatches with 401.
- [ ] Webhook handlers are idempotent — use the provider's event ID for dedup.
- [ ] Outbound webhooks signed with HMAC; recipient should verify.

## Output / responses
- [ ] Strip server stack traces from error responses to clients. Return `{"error":"Internal server error"}` with HTTP 500; log full details server-side.
- [ ] Strip PII from response payloads when not needed (don't return full user objects from `/api/users/list` — only id+name+avatar).
- [ ] Set `X-Content-Type-Options: nosniff`. APIs serve JSON only — no HTML rendering needed.
- [ ] CORS: explicit allowlist of origins (`Access-Control-Allow-Origin: https://app.example.com`), never `*` when credentials are involved.

## SSRF / outbound
- [ ] When the API fetches external URLs (proxying user requests, link previews), allowlist hosts. Block `127.0.0.1`, `localhost`, RFC1918 IPs, `169.254.169.254` (cloud metadata).
- [ ] Validate URLs after DNS resolution (an attacker-controlled DNS record can resolve to an internal IP).

## Logging & monitoring
- [ ] Log structured JSON: `{level, ts, route, status, latency_ms, tenant_id, request_id}`. NEVER `Authorization` headers, full bodies, or PII.
- [ ] Errors include a correlation ID surfaced to the client (e.g., `X-Request-Id`) so support can find the log without seeing it.
- [ ] Audit log for state changes: who did what, when, on which tenant.
