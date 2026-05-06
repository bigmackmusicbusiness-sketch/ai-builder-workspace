# Security checklist — Automation panel

Automation panels chain webhook receivers, scheduled jobs, and outbound
calls. They're n8n / Zapier / Make-style surfaces. The biggest risks:
SSRF (user-supplied URLs fetched by your server), webhook spoofing,
unbounded execution.

## Webhook signature verification
- [ ] Every inbound webhook validates an HMAC signature from the provider's signing secret. Reject mismatches with 401.
  - Stripe: `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`
  - GitHub: `crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')` compared to `X-Hub-Signature-256`.
  - Slack: signature based on timestamp + body, replay protection on `X-Slack-Request-Timestamp` (reject if > 5 min old).
- [ ] Use `crypto.timingSafeEqual` for the comparison — `===` leaks timing.
- [ ] Verify against the RAW request body, not the parsed JSON. Body parsing changes whitespace and breaks the hash.

## Replay protection
- [ ] Persist event IDs (Stripe `event.id`, GitHub `X-GitHub-Delivery`) and reject duplicates.
- [ ] Reject events with timestamps older than 5 minutes.

## Outbound HTTP / SSRF defense
- [ ] User-configured webhook URLs (e.g., "send to my Slack") MUST go through an SSRF-safe fetcher:
  - Block `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`.
  - Block RFC1918 private IPs: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.
  - Block link-local: `169.254.0.0/16` (cloud metadata at `169.254.169.254`).
  - Block IPv6 ULAs: `fc00::/7`, `fe80::/10`.
  - Resolve DNS BEFORE the fetch and re-check the resolved IP isn't in any blocked range. (Attackers can use a domain that resolves to a blocked IP.)
- [ ] Set a connect timeout (5s) and total timeout (30s) on outbound calls.
- [ ] Disable HTTP redirects or follow them through the same SSRF check.
- [ ] Cap response body size (10 MB) to prevent memory exhaustion.

## Job execution safety
- [ ] Each automation runs in a sandbox with bounded CPU time + memory + wall-clock.
- [ ] Failed jobs retry with exponential backoff, MAX 5 retries — then dead-letter queue.
- [ ] Jobs that mutate external state are idempotent (use a deterministic dedup key).
- [ ] Per-tenant queue isolation — one tenant's runaway job doesn't starve others.

## Inputs to actions
- [ ] User-defined templates (e.g., "send email with subject {{user.email}}") render with a sandboxed templating engine. NEVER `eval()` or `new Function()` — pre-compiled templates only.
- [ ] If the panel runs user JavaScript, isolate via `vm2` (Node) or a worker with CSP. Strip `require`, `process`, network access, file system.
- [ ] Stored "actions" reviewed for malicious patterns on save.

## Auth on the trigger surface
- [ ] Public webhooks (received from third parties) authenticated by the signature above.
- [ ] Private actions (admin trigger, manual run) require user auth with the appropriate role.
- [ ] Cron / scheduled jobs run as a service account, not as a privileged user.

## Logging
- [ ] Every webhook receipt logged with the verified source.
- [ ] Every outbound call logged with target host (NOT full URL — query strings may have tokens).
- [ ] Failures include enough context to debug but redact secrets / PII before logging.
