# Security checklist — Full-stack app

You're shipping both the frontend and the backend. That means you're
responsible for the full attack surface: client-side XSS, server-side
SQL injection, auth flow correctness, deployment headers. Apply BOTH
the SaaS-app and the API-service checklists, plus the items below.

## End-to-end secrets discipline
- [ ] Backend env vars: `DATABASE_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, etc. — server-only.
- [ ] Frontend env vars (Vite/Next/Nuxt `VITE_*` / `NEXT_PUBLIC_*` / `PUBLIC_*`): ANY of these is bundled into the public JS. Treat them as public. ONLY store URLs, anon keys, or other already-public values there.
- [ ] If using Supabase: `SUPABASE_URL` + `SUPABASE_ANON_KEY` go in the client. `SUPABASE_SERVICE_ROLE_KEY` is server-side ONLY.

## SSR / hydration
- [ ] When server-rendering, escape user content during HTML generation. Most frameworks do this; verify when interpolating raw strings.
- [ ] Don't ship initial state as inline JSON to the client without escaping `<` and `>` (or use `JSON.stringify` with safe-mode replacer for `</script>`).
- [ ] Hydration mismatch warnings are a security signal — investigate, don't suppress.

## Forms & XSS
- [ ] All form inputs render through framework escape (`{value}` in React/Vue). Never `dangerouslySetInnerHTML` with user input.
- [ ] File inputs validate the file type client-side (UX) AND server-side (security — client checks are bypassable).
- [ ] CSRF tokens included as hidden inputs in HTML forms; or use `X-Requested-With` header on `fetch()` requests.

## Routing & redirects
- [ ] Client-side router doesn't pass user-controlled data to `window.location` directly.
- [ ] Server-side redirects validate the target. `?next=https://evil.com` is open-redirect → phishing.
- [ ] Don't expose internal route IDs that imply structure (`/admin-internal/users` is found in 5 seconds — gate by role, don't rely on obscurity).

## Production deployment
- [ ] Source maps NOT served from production (or only with auth). They reveal full source + variable names.
- [ ] Environment-specific builds: dev features (Sentry source maps inline, debugger statements, `console.log` of auth tokens) stripped in prod.
- [ ] Strict CSP set via meta tag AND server header. Prefer `nonce-…` for inline scripts over `'unsafe-inline'`.
- [ ] HSTS with `preload` directive once the domain is stable.
- [ ] Health-check endpoints don't leak version info, dependency lists, or internal structure.

## Database migrations
- [ ] Migrations run via a controlled pipeline, not on first request. Include rollback plans for destructive changes.
- [ ] Schema changes that drop columns/tables are two-phase: stop-using-it deploy → drop deploy.
- [ ] RLS policies enabled on user-data tables as defense-in-depth.

Pull from `saas-app/security_checklist.md` for the multi-tenancy/Stripe layer
and `api-service/security_checklist.md` for the API layer. Don't duplicate
the items here — implement them.
