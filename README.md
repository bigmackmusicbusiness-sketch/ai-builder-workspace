# AI Builder Workspace

An internal-first, full-stack AI builder/operator workspace. Collapsible left AI/chat
panel + a dominant main workspace (Preview / Code / Files / Console / Tests / Visual
QA / Split) that builds, runs, and verifies websites, landing pages, dashboards,
internal tools, onboarding flows, automation control panels, SaaS frontends, APIs,
and full-stack apps. First-class for websites and client onboarding automation.
Honest verification loops. No silent model auto-routing. Hard security posture.

## Governing documents

- `HANDOFF.md` — authoritative build brief. Read first.
- `HANDOFF_NOTES.md` — live progress log. Updated after every step.
- UI Playbook for AI Agents — `C:/Users/telly/OneDrive/Documents/Ui Playbook For Ai Agents.pdf`
- SignalPoint Systems Master Blueprint + Exhaustive Build Plan (on Desktop).

## Prerequisites

- Node 20.11+ (`nvm use`)
- pnpm 9+
- Docker (for ephemeral Postgres + sandboxed preview runners)
- Supabase CLI (local stack)
- Wrangler (Cloudflare Workers)

## Install & run

```bash
pnpm install
cp infra/env/.env.example .env
# fill in values — vault master key is required for /api to boot
pnpm -w dev
```

Checks used by CI:

```bash
pnpm -w lint
pnpm -w typecheck
pnpm -w build
pnpm -w test:unit
pnpm -w secret-scan
pnpm -w dep-vuln
```

## Structure

```
apps/      web (React+Vite+Monaco), api (Fastify+Drizzle), worker (Cloudflare preview)
packages/  ui, agent-core, providers, project-types, publish, security, db, verify, shared
infra/     supabase, cloudflare, upstash, env templates
```

## Security

- All secrets live in the server-side vault. The browser never sees secret values.
- All sensitive actions pass through the approval matrix in `/api`.
- All sensitive actions write to `audit_events`.
- No free-form model output can directly execute sensitive actions.
