# Working in this repo (CLAUDE.md)

> The IDE is **internal-live** — every commit can break a real customer's
> session. Read this top-to-bottom before doing anything that ships.

## Session-start rule (read FIRST every new session)

1. **Check `HANDOFF_NOTES.md`** for any `## INBOUND FROM SPS — <date>` section
   that hasn't been resolved. SignalPointSystems sometimes writes back here
   when its work is done; if a write-back exists and Phase 3 hasn't started,
   that's the next priority.
2. **Check the active plan** at `~/.claude/plans/eventual-leaping-petal.md`.
   The plan tells you which phase you're in and what's gating the next step.
3. **Then** start whatever the user asks.

## Source of truth

- Authoritative brief: `HANDOFF.md` at the repo root.
- Live progress log: `HANDOFF_NOTES.md` (reverse-chronological; the most
  recent entry is the current state).
- Active plan: `~/.claude/plans/eventual-leaping-petal.md`.
- Governing UI rules: `C:/Users/telly/OneDrive/Documents/Ui Playbook For Ai Agents.pdf`.
- Sister project (back-office, customer admin): **SignalPointSystems** at
  `C:/Users/telly/OneDrive/Desktop/SignalPointSystems`. Its CLAUDE.md is
  the source of truth for that codebase. Cross-project handoff happens via
  `HANDOFF_NOTES.md` (here) and `handoff/INBOUND_FROM_ABW_*.md` (there).

## Repo facts

- Root: `C:\Users\telly\OneDrive\Desktop\AI Ops\AI Builder Workspace`
- Package manager: **pnpm 9** + **turborepo**
- Node: 20.11+ (`.nvmrc` present)
- Workspace glob: `apps/*`, `packages/*`
- Path aliases: `@abw/ui`, `@abw/agent-core`, `@abw/providers`,
  `@abw/project-types`, `@abw/publish`, `@abw/security`, `@abw/db`,
  `@abw/verify`, `@abw/shared`
- Apps: `apps/api` (Fastify), `apps/web` (Vite SPA), `apps/worker`
  (Cloudflare KV preview)
- Deploy chain: GitHub → Coolify (api) + Cloudflare Pages (web)
- Hosts (current): `https://api.40-160-3-10.sslip.io`, `https://app.40-160-3-10.sslip.io`

## Non-negotiable conventions

- **TypeScript strict everywhere; Zod at every boundary.**
- **Spacing tokens only from `4 / 8 / 12 / 16 / 24 / 32 / 40`.**
- **Single accent color** (SignalPoint teal `#1B8E8C`); never communicate
  state with color alone.
- **CSS class namespace: `.abw-*`** for every IDE class.
- **Secrets server-side only.** The browser never sees a secret value.
- **Repository pattern for DB access**; no `db.*` calls in routes.
- **Every non-trivial file starts with a 1-line purpose comment.**

## SOP rules — every commit

1. **Pre-merge:** `pnpm typecheck` clean across all 12 packages.
   `pnpm --filter @abw/api build` clean. `pnpm --filter @abw/web build` clean.
2. **Commit message:** present-tense, scope-prefixed
   (`feat(niches): batch 4/12 — auto`, `fix(ads): foo`, etc.).
3. **Push** to `main`. Coolify rolls api in ~6 min; Cloudflare Pages rolls
   web in ~1 min.
4. **Post-deploy verification:** run `pnpm tsx apps/api/scripts/post-deploy-check.ts`
   (needs `$ABW_TOKEN`). Must exit 0. Audit log auto-writes to
   `docs/post-deploy/<timestamp>.md`.
5. **If any check fails:** revert, do not patch forward. Internal-live SaaS
   rules.

## The niche manifest contract

Every file in `apps/api/src/agent/skills/types/website/niches/<slug>.json`:

- Validates against the `NicheManifest` Zod schema in
  `apps/api/src/agent/phases/plan.ts:57-70` (uses `.passthrough()` so adding
  new optional fields is safe).
- Has 3 corresponding ad-copy patterns in `apps/api/src/routes/ads/copyPatterns.ts`
  (one per framework: specific-value-prop / pattern-interrupt / before-after).
- Every copy pattern passes `apps/api/src/routes/ads/slopBlocker.ts` —
  no `amazing`, `world-class`, `cutting-edge`, `transformative`, `next-level`,
  `unlock`, `elevate`, `leverage`, `revolutionary`, `game-changing`,
  `take it to the next`, `unleash`.
- Trigger keyword sets are mutually distinctive across niches (don't make
  "studio" alone disambiguate — pair with another word).

## The standalone-IDE guarantee

**Cross-project integration with SignalPointSystems is opt-in.** Every code
path checks `if (!hasSignalPointConfig) renderStaticOnly()` first. A workspace
without an SPS connection produces fully static HTML+Tailwind sites — same
as today. Any change that breaks this guarantee is reverted on sight.

## Phases (current plan)

The active multi-phase plan is at `~/.claude/plans/eventual-leaping-petal.md`.
Today: Phase 1 in progress (101 niches over 12 batches). Phase 2 dispatches
a handoff doc to SignalPointSystems. Phase 3 wires the cross-platform glue.

## Cross-project coordination

When ABW finishes a phase that hands off to SPS:

1. Write the doc to `C:/Users/telly/OneDrive/Desktop/SignalPointSystems/handoff/INBOUND_FROM_ABW_<date>.md`.
2. Append a `## OUTBOUND TO SPS — <date>` marker to `HANDOFF_NOTES.md` here.
3. Optionally fire `C:/Users/telly/OneDrive/Desktop/AI Ops/scripts/notify-handoff.ps1`
   to surface a Windows toast so the user remembers to switch sessions.

When SPS finishes its work, its agent appends `## INBOUND FROM SPS — <date>`
to `HANDOFF_NOTES.md` here. Next ABW session reads that first.

---

If anything here conflicts with `HANDOFF.md`, `HANDOFF.md` wins.
