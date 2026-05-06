# Contributing to the AI Builder API

## Secret-handling protocol

Never commit secrets. The api has three classes of "secret-shaped" data and
each class lives in a specific place:

1. **Service config** — `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `VAULT_MASTER_KEY`, `MINIMAX_API_KEY`, `REPLICATE_API_TOKEN`. These are
   server-side env vars, set in Coolify (or your deploy platform) and
   referenced via `process.env.X`. They never appear in source.
2. **Tenant secrets** — third-party API keys a user wires up in the
   Settings → Env Secrets surface (e.g., their own Stripe key for payment
   integrations). These go through `apps/api/src/security/vault.ts`,
   encrypted with `VAULT_MASTER_KEY` (AES-256-GCM) before storage.
3. **Public client config** — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
   These ARE in the web bundle and that's fine; they're public by design.
   Anything else that starts with `VITE_*` is also public — never put a
   real secret behind a `VITE_` prefix.

When adding a new secret-shaped value, ask which class it belongs to. If
the answer is "I'm not sure", the safe default is class 1 (server env).

## Code-level security guardrails (already wired)

- `apps/api/src/agent/security.ts` — `scanForCredentials` blocks the
  agent's `write_file` if it detects hardcoded credentials. Severity
  `block` halts the write; `strip` replaces inline with `[REDACTED-…]`.
  Add new patterns here when a provider's key format becomes known.
- `apps/api/src/agent/tools.ts` — the `write_file` tool runs the scan
  PRE-write, so unsafe content never reaches disk or Supabase Storage.
  It also hard-rejects `.env` files (use `.env.example` instead).
- `apps/api/src/security/csrfGuard.ts` — non-GET routes require either
  `X-Requested-With` or `Sec-Fetch-Site: same-origin/site` header. Add
  the `X-Requested-With: fetch` header when issuing fetch/XHR from the
  SPA.
- `apps/api/src/agent/phases/polish.ts` — runs after every chat that
  produced files. Auto-injects baseline security meta tags (CSP, viewport,
  referrer-policy), strips JWT-shaped tokens that slipped through, flags
  niche-required compliance disclaimers (Fair Housing, HIPAA, SEC, etc.).

## Workflow for security-sensitive changes

When you touch auth, secrets, RLS, the vault, or the agent's write_file
gate, mention `[security]` in your commit message and call out the
threat-model change. Reviewers should treat those commits with extra care.
