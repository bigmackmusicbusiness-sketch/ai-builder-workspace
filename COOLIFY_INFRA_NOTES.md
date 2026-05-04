# Coolify infra notes — read this if you deploy through Coolify

Last updated: 2026-05-03 by the SignalPoint Systems Claude session.

## TL;DR

Coolify dashboard moved from plain HTTP at `http://40.160.3.10:8000` to HTTPS at:

```
https://coolify.signalpointportal.com
```

The old IP+port URL still works but isn't recommended (plain HTTP — session cookies sniffable on the wire).

## What changed

- New DNS A record: `coolify.signalpointportal.com → 40.160.3.10` (Cloudflare zone, DNS-only / gray cloud, so Let's Encrypt HTTP-01 challenges hit Traefik directly).
- Coolify Settings → Configuration → General → URL was set to `https://coolify.signalpointportal.com`. Coolify auto-issued an LE cert via its own Traefik in ~15 seconds.
- HTTPS verify passes. HTTP→HTTPS redirect handled by Coolify's Traefik.

## Why this matters for your project

If you (the AI Builder Workspace / signalpoint-ide session) deploy via Coolify on the same VPS (`40.160.3.10`):

1. **Use the new URL for any browser actions** against the Coolify dashboard — the IP one still works but you'll be moving credentials over plain HTTP.
2. **API calls don't change** — same `/api/v1/*` paths, just hit `https://coolify.signalpointportal.com` instead of `http://40.160.3.10:8000`. Tokens still work.
3. **Traefik is shared.** Anything you deploy through this Coolify instance shares the same Traefik proxy. If you add more apps with FQDN labels they'll get LE certs the same way the SignalPoint apps did. Don't try to bind ports 80/443 directly — Traefik owns them.
4. **There's an existing API token rotation:** `signalpoint-cli-v2` (non-expiring, root scope). If you need a separate token for your project create one at `https://coolify.signalpointportal.com/security/api-tokens` so we can revoke independently if needed.

## Other shared infra you should know about

- Same VPS runs the SignalPoint compose stack: 3 web apps (web-internal/client/affiliate), 1 worker, 1 scheduler, 1 valkey. Plus the AI Builder Workspace as a separate Coolify app.
- DNS: Cloudflare zone `signalpointportal.com`. CF api_token is in Supabase project `savtjkhnddapjuaiioda`.`provider_runtime_secrets` table (provider='cloudflare', secret_key='api_token'). Use `tooling/scripts/setup/connect-domain.mjs` in the SignalPointSystems repo as a reference for adding records via the API.
- GitHub Actions auto-deploy: every push to `main` on the SignalPoint repo triggers Coolify deploy via `.github/workflows/deploy.yml` using `COOLIFY_TOKEN` + `COOLIFY_APP_UUID` repo secrets. Mirror this pattern if you want auto-deploy too.
- All apps behind Coolify's Traefik are getting Let's Encrypt certs automatically based on the `traefik.http.routers.<svc>-https.tls.certresolver=letsencrypt` label in their docker-compose.

## Don't do

- Don't put `Cloudflare Proxy: ON` (orange cloud) on subdomains until you've moved cert termination to Cloudflare. With CF proxy ON + DNS-only mode mismatch, LE HTTP-01 challenges fail.
- Don't disable the existing Traefik or change its config — multiple apps depend on it. Add labels per service instead.
