# Coolify deploy — AI Builder Workspace

This folder is the deploy substrate for running the app on a self-hosted
Coolify v4 instance (single VPS). The compose brings up three services:

| Service | Image / Build                          | Public? | Port (internal) |
|---------|----------------------------------------|---------|-----------------|
| `api`   | `apps/api/Dockerfile.coolify`          | yes     | 3007            |
| `web`   | `apps/web/Dockerfile.coolify` (nginx)  | yes     | 80              |
| `redis` | `redis:7-alpine`                       | no      | 6379            |

Postgres stays on Supabase (no change). Cloudflare KV (preview cache) stays as
an optional add-on — wire `CF_*` env vars only if you want production preview
URLs to live on the worker; otherwise local dev mode kicks in and previews
serve from the API itself.

---

## One-time setup in the Coolify UI

> The repo and Coolify host are private to the user. The `octolegion-deploy`
> source belongs to a separate project — leave it alone.

1. **Add a GitHub source for this repo**
   - Coolify → Sources → `+ Add` → GitHub App
   - Install on the GitHub account that owns
     `bigmackmusicbusiness-sketch/ai-builder-workspace` (private)
   - Grant access to that repo only

2. **Create the project**
   - Coolify → Projects → `+ Add` → Name: `AI Builder Workspace`
   - Server: `localhost` · Destination: `coolify`

3. **Add a Docker Compose resource**
   - Inside the new project → `+ Add Resource` → Docker Compose
   - Source: the GitHub App you just added
   - Repository: `bigmackmusicbusiness-sketch/ai-builder-workspace`
   - Branch: `main`
   - Compose path: `infra/coolify/docker-compose.yml`
   - Save (do **not** deploy yet — env vars first)

4. **Set the `api` service env vars** (Service → `api` → Environment Variables)
   Required (boot fails without these):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_JWT_SECRET`
   - `VAULT_MASTER_KEY` — 32-byte base64. Generate with:
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
     ```
     ⚠ MUST be the SAME value you used on Railway, otherwise existing vault
     entries (Higgsfield token, MiniMax key, etc.) won't decrypt.

   Optional but recommended:
   - `PUBLIC_API_URL` — public HTTPS URL the browser uses to reach this api
     (e.g. `https://api.your-domain.com`)
   - `OPENAI_API_KEY` — Whisper transcription for the AI Clipper
   - `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_KV_PREVIEW_NAMESPACE_ID` — only if
     you want production preview URLs served by the Cloudflare Worker

5. **Set the `web` service BUILD-TIME variables**
   (Service → `web` → Build → Build Variables — these bake into the bundle)
   - `VITE_API_URL` — same `https://api.your-domain.com`
   - `VITE_SUPABASE_URL` — same as `SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` — same as `SUPABASE_ANON_KEY`

6. **Configure domains**
   - `web` → Domains tab → add e.g. `app.your-domain.com`
   - `api` → Domains tab → add e.g. `api.your-domain.com`
   - Coolify auto-issues Let's Encrypt certs once DNS resolves to the VPS

7. **Trigger the deploy** — `Deploy` button on the resource page.
   Watch logs; healthchecks should turn green within ~3 min for a cold build.

---

## After it boots

- Visit `https://app.your-domain.com` → login screen
- Login goes through Supabase Auth (same as Railway — no migration needed)
- Apply any pending migrations: from your local repo,
  `pnpm db:migrate` (uses the Supabase `DATABASE_URL` directly)
- Confirm `https://api.your-domain.com/healthz` returns `{ok: true}`

## Cutover from Railway

Once smoke tests pass on the new domain:

1. Update DNS A records for `app.*` and `api.*` to the VPS IP
2. Wait for Let's Encrypt to issue
3. Test login + a single chat message + a preview boot
4. Decommission Railway service

DNS rollback is instant if anything fails — just point back at Railway.

## Notes

- Redis is local-only (`expose`, not `ports`). API reaches it at
  `redis:6379` over the internal Docker network.
- The `worker` (clipper background processor) is not yet a separate service —
  the clipper currently runs in-process inside the api container. When the
  Phase-D clipper queue lands, add a fourth `worker` service in this compose
  pointing at the same `apps/api/Dockerfile.coolify` but with
  `CMD ["node","apps/api/dist/clipper-worker.js"]`.
- Workspaces (per-tenant `~/.abw-workspaces/{tenant}/{slug}/`) live on the
  api container's filesystem. If you scale `api` past 1 replica, mount a
  shared volume or migrate workspaces to Supabase Storage.
