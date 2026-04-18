# HANDOFF: Build the AI Builder/Operator Workspace

> **You are an AI coding agent.** This file is your complete build brief. Read it top-to-bottom before writing any code. Do not skip steps. Do not improvise structure. Do not ship without verification. The product is internal-first, full-stack, premium, and safety-critical.

---

## 0. Governing Documents (read first, treat as law)

1. **UI Playbook for AI Agents** — `C:/Users/telly/OneDrive/Documents/Ui Playbook For Ai Agents.pdf`
   - Layout rules, hierarchy, spacing system (4/8/12/16/24/32/40), single-accent color, surface restraint, state coverage (default / loading / empty / success / error / disabled / permission-limited / long-content / mobile-tablet), motion restraint, typography roles, anti-patterns (card soup, over-styling, weak hierarchy, overflow, too many boxes, fancy navigation, no empty states, no error recovery, decorative motion).
   - Mandatory review checklist (Part 13) and Hard Bans (Part 14) apply to every screen.
2. **SignalPoint security guides** —
   - `C:/Users/telly/OneDrive/Desktop/SignalPoint_Systems_Master_Blueprint.pdf`
   - `C:/Users/telly/OneDrive/Desktop/SignalPoint_Systems_Exhaustive_Build_Plan.pdf`
   - Secret handling, server-side authz, agent rules, approval gates, audit, rollback, untrusted-input posture.

If a step in this handoff conflicts with the UI Playbook or SignalPoint docs, the docs win. Stop and reconcile.

---

## 1. Product One-Liner

A premium, internal-first, full-stack AI builder/operator workspace. Collapsible left AI/chat/task panel + dominant main workspace (Preview / Code / Files / Console / Tests / Visual QA / Split). Builds and verifies websites, landing pages, dashboards, internal tools, onboarding flows, automation control panels, SaaS frontends, APIs, full-stack apps. First-class for websites and client onboarding automation. Honest verification loops (runtime + visual + backend + safety). No silent model auto-routing. Hard security posture.

---

## 2. Non-Negotiables (verify against these at every milestone)

- Collapsible LEFT AI panel + dominant MAIN workspace. **No** fixed 3-column. **No** permanent right AI panel. Left panel collapses without losing chat/run/approval/target state.
- Preview is usually the dominant surface. Code/Files/Console/Tests/Visual QA/Split are modes inside the main workspace, not extra sidebars.
- Selected provider/model is **always visible**. Manual selection per run. Pin per run. Record on every run + step. **No silent fallback.** Fallback is opt-in and visibly banner-warned.
- MiniMax 2.7 + Ollama wired. Secrets server-side only.
- Agent loop = plan → identify affected files → small edit → run → inspect (runtime + visual + backend) → fix → re-verify → summarize. Completion ≠ "code written"; completion = verification matrix green.
- Approval matrix enforced **server-side** (not just UI).
- Default state is empty. No fake demo data.

---

## 3. Stack & Topology

```
Monorepo (pnpm workspaces + turborepo)
/apps
  /web         React 18 + TypeScript + Vite + Monaco + TanStack Router + TanStack Query + Zustand
  /api         Node 20 + Fastify + TypeScript + Zod + Drizzle ORM
  /worker      Cloudflare Worker (preview sandbox proxy, edge logic)
/packages
  /ui          design tokens + headless primitives (Radix) + composed components
  /agent-core  agent roles, orchestrator, run memory, compactor, tool contracts
  /providers   model adapters (minimax, ollama, registry, healthcheck)
  /project-types  Website, Landing Page, Dashboard, Internal Tool, Onboarding Flow,
                  Automation Control Panel, SaaS App, API Service, Full-Stack App, Blank
  /publish     Cloudflare Pages, Supabase, static export adapters
  /security    vault client, redact, authz, approvalMatrix, audit, secretScan
  /db          drizzle schema + migrations + repositories
  /verify      lint, typecheck, build, unit, integration, e2e, secret-scan, dep-vuln,
               migration-smoke, playwright runtime, screenshot diff
  /shared      zod contracts shared between web/api/worker
/infra         supabase config, cloudflare wrangler, upstash config, env templates
```

**External services**
- **Supabase**: Postgres (data), Auth (users), Storage (assets, snapshots, screenshots), Realtime (run/console streaming).
- **Cloudflare Workers + Pages**: per-project preview sandbox + publish target.
- **Upstash Redis + QStash**: agent step queue, cron, retries, webhook replay buffer.
- **Ollama** (local) and **MiniMax 2.7** (remote): model providers behind a uniform adapter.
- **Playwright** (server-side, in `/api`): boot preview, screenshot, e2e, visual diff.

**Hard runtime split**
- Browser: UI only. **Never** holds secrets. **Never** calls providers directly.
- `/api`: provider proxy, vault access, agent orchestration, approval gates, audit writer, Playwright runner.
- `/worker`: sandboxed user-code preview on a per-project subdomain.

---

## 4. Repository Layout (create exactly this)

```
/                          # root
  package.json             # private, workspaces
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  .editorconfig
  .gitignore
  .nvmrc                   # node 20
  README.md                # short, internal
  /apps
    /web
      package.json
      vite.config.ts
      tsconfig.json
      index.html
      /src
        main.tsx
        app/
          Shell.tsx                      # layout shell
          Router.tsx
          theme.ts
        layout/
          LeftPanel/
            LeftPanel.tsx
            ChatThread.tsx
            RunHistory.tsx
            PlanSummary.tsx
            ApprovalsQueue.tsx
            TargetContextChip.tsx
            AgentStatus.tsx
            ModelSelector.tsx            # always-visible model selector
            CollapseToggle.tsx
          MainWorkspace/
            Workspace.tsx                 # mode router + split
            ModeTabs.tsx
            modes/
              PreviewMode.tsx
              CodeMode.tsx
              FilesMode.tsx
              ConsoleMode.tsx
              TestsMode.tsx
              VisualQAMode.tsx
              SplitMode.tsx
          TopBar/
            EnvBadge.tsx
            ProjectSwitcher.tsx
            GlobalSearch.tsx
            ProfileMenu.tsx
        screens/
          ProjectsScreen.tsx
          WorkspaceScreen.tsx
          AgentRunsScreen.tsx
          VersionsScreen.tsx
          AssetsScreen.tsx
          TemplatesScreen.tsx
          OnboardingAutomationScreen.tsx
          ProviderSettingsScreen.tsx
          PublishScreen.tsx
          LogsHealthScreen.tsx
          IntegrationsScreen.tsx
          EnvSecretsScreen.tsx            # secret METADATA only
          DatabaseSchemaScreen.tsx
          JobsQueuesScreen.tsx
          AppSettingsScreen.tsx
        features/
          editor/                          # Monaco wrapper, tabs, dirty/save
          preview/                         # iframe + device sizes + console overlay
          diff/                            # diff viewer
          files/                           # tree + search + impact
          console/                         # log stream
          tests/                           # verification matrix UI
          visualqa/                        # screenshot grid + diff
          chat/                            # streaming chat UI
          approvals/                       # approval bundles
          versions/                        # snapshots + restore
          providers/                       # model selector + provider settings
        lib/
          api.ts                            # typed API client (zod)
          ws.ts                             # Realtime client
          store/                            # zustand stores (target, run, env)
          format/, hooks/, utils/
        styles/
          tokens.css                        # imports from packages/ui
          globals.css
    /api
      package.json
      tsconfig.json
      src/
        server.ts                           # Fastify bootstrap
        routes/
          auth.ts
          projects.ts
          files.ts
          versions.ts
          runs.ts
          approvals.ts
          providers.ts                      # provider proxy + healthcheck
          secrets.ts                        # metadata only; vault behind it
          publish.ts
          preview.ts
          tests.ts                          # trigger verification matrix
          db.ts                             # SQL editor / table viewer endpoints
          jobs.ts
          webhooks.ts
          audit.ts
        agent/
          orchestrator.ts
          runMemory.ts
          compactor.ts
          tools/                            # typed tool contracts
            fs.read.ts
            fs.write.ts                     # scoped, audited
            fs.diff.ts
            shell.exec.ts                   # sandboxed
            preview.boot.ts
            preview.screenshot.ts
            verify.run.ts
            db.migrate.ts
            db.query.ts
            integration.invoke.ts
          roles/
            planner.ts
            builder.ts
            runtime.ts
            visual.ts
            backend.ts
            fixer.ts
            release.ts
        providers/
          registry.ts
          minimax.ts
          ollama.ts
          types.ts                          # adapter interface
        security/
          vault.ts                          # libsodium sealed-box wrappers
          authz.ts                          # tenant + role guards
          approvalMatrix.ts                 # rules + decision engine
          redact.ts                         # log + screenshot redaction
          audit.ts                          # audit_events writer
          secretScan.ts                     # gitleaks-style patterns
          rateLimit.ts
        verify/
          pipeline.ts                       # orchestrate matrix
          adapters/
            lint.ts
            typecheck.ts
            build.ts
            unit.ts
            integration.ts
            e2e.ts
            depVuln.ts
            migrationSmoke.ts
            playwrightRuntime.ts
            screenshotDiff.ts
        db/
          client.ts                         # drizzle client
          repositories/                      # all DB access goes through here
        realtime/
          channels.ts                       # Supabase Realtime publishers
        config/
          env.ts                            # zod-parsed config
    /worker
      package.json
      wrangler.toml
      src/
        preview.ts                          # serves project sandbox
        sandbox.ts                          # isolation primitives
        edge.ts                             # cache + headers
  /packages
    /ui
      package.json
      tokens/
        spacing.ts                          # 4 8 12 16 24 32 40
        type.ts                             # Display, H1, H2, H3, Body, BodySm, Label, Caption
        color.ts                            # neutral scale + ONE accent + semantic
        radius.ts                           # field, button, card
        elevation.ts                        # base, elevated, overlay
        motion.ts                           # durations + easings + reduced-motion
      primitives/                           # Button, Input, Select, Tabs, Dialog, Popover,
                                            # Tooltip, Toast, Menu, Tree, Resizable, Toolbar,
                                            # ScrollArea, Skeleton, Banner, Badge, Chip
      patterns/                             # PageHeader, EmptyState, ErrorState, LoadingState,
                                            # PermissionGate, SectionDivider
      index.ts
    /agent-core
      types.ts                              # Run, Step, Tool, Finding, Verification
      contracts.ts                          # zod tool I/O contracts
      memory.ts
      compactor.ts
      budget.ts                             # max-step / max-time / max-cost
    /providers
      types.ts                              # ProviderAdapter interface
      registry.ts
    /project-types
      website/
      landing-page/
      dashboard/
      internal-tool/
      onboarding-flow/
      automation-panel/
      saas-app/
      api-service/
      full-stack-app/
      blank/
      index.ts                              # registry + scaffolding API
    /publish
      cloudflare-pages.ts
      supabase.ts
      static-export.ts
      types.ts
    /security
      patterns.ts                           # secret regex + ignore list
      redact.ts                             # shared redactor (used by api + verify)
      authzShared.ts
    /db
      schema/                               # drizzle tables
      migrations/                           # generated SQL
      seed/                                 # ONLY for tests (no demo data in prod)
    /verify
      shared/                               # shared types between api/verify adapters
    /shared
      contracts/                            # zod schemas shared web<->api<->worker
      events.ts                             # realtime event names + shapes
  /infra
    supabase/
      config.toml
      sql/                                  # bootstrap SQL (RLS policies, etc.)
    cloudflare/
      wrangler.toml.example
    upstash/
      README.md
    env/
      .env.example
      .env.local.example
```

---

## 5. Build Order (execute in this exact sequence; do not skip)

Each step has: **deliverables**, **acceptance**, **do-not-do**. You may not advance until acceptance passes.

### STEP 1 — Repo, tooling, base config

**Deliverables**
1. `pnpm` monorepo with `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`.
2. ESLint (typescript-eslint, react, react-hooks, jsx-a11y) + Prettier + lint-staged + husky pre-commit.
3. `tsconfig` paths set up across `apps/*` and `packages/*`.
4. `.env.example` with every required key (see §11).
5. `infra/supabase/config.toml`, `infra/cloudflare/wrangler.toml.example`, `infra/upstash/README.md`.
6. Root `README.md` with one-paragraph product description + how to run.
7. CI config (GitHub Actions): `lint`, `typecheck`, `build`, `unit`, `secret-scan`, `dep-vuln` on every PR.

**Acceptance**: `pnpm install && pnpm -w lint && pnpm -w typecheck && pnpm -w build` all pass on an empty scaffold.

**Do not**: commit any real secrets, demo data, or screenshot fixtures yet.

---

### STEP 2 — Design tokens & UI primitives (`packages/ui`)

**Deliverables**
1. **Tokens** strictly per the UI Playbook:
   - Spacing scale: `4, 8, 12, 16, 24, 32, 40`. No other values allowed.
   - Type scale: `Display, H1, H2, H3, Body, BodySm, Label, Caption`. Define line-height, weight, tracking. No ultra-light weights for important content.
   - Color: neutral scale (10 steps), **one** accent, semantic `success/warning/error/info`. Never communicate state with color alone.
   - Radius: `field` (medium), `button` (medium), `card` (large). One language; no random mixing.
   - Elevation: `base`, `elevated`, `overlay`. Subtle by default. Do not stack heavy borders + heavy shadows.
   - Motion: `fast (120ms)`, `base (180ms)`, `slow (240ms)`, easings `standard / decelerate / accelerate`. Respect `prefers-reduced-motion`.
2. **Primitives** built on Radix (headless): `Button` (primary/secondary/ghost/destructive with proper hierarchy + disabled-explains-why slot + loading preserves size), `Input`, `Textarea`, `Select`, `Combobox`, `Tabs`, `Dialog`, `Popover`, `Tooltip`, `Toast`, `Menu`, `Tree`, `Resizable` (split panes), `Toolbar`, `ScrollArea`, `Skeleton`, `Banner`, `Badge`, `Chip`, `Kbd`.
3. **Patterns**: `PageHeader` (title + concise sub + ONE primary action slot), `EmptyState` (label + reason + next-step + optional illustration slot), `ErrorState` (specific + calm + actionable), `LoadingState` (skeleton, never blank), `PermissionGate`, `SectionDivider` (uses spacing/alignment first, border last).
4. Storybook (or Ladle) for every primitive + pattern with all states (default/loading/empty/error/disabled/long-content/mobile).

**Acceptance**: every primitive renders all required states; axe-core passes; visual review against UI Playbook §13 checklist.

**Do not**: ship cards-around-everything, multiple accents, glassmorphism, autoplay carousels, or decorative motion.

---

### STEP 3 — Database schema, RLS, audit, vault

**Deliverables (`packages/db/schema`)** — Drizzle tables with timestamps + soft-delete + tenant + created_by:

`tenants`, `users`, `memberships`, `projects`, `project_types`, `files` (path + content_hash + size + lang + dirty), `file_blobs` (content-addressed), `components`, `pages`, `routes`, `services`, `schemas`, `migrations` (status + env + applied_at), `jobs`, `webhooks`, `assets`, `brand_kits`, `templates`, `versions` (snapshot of file→blob map), `agent_runs` (goal, model, status, budget, started_at, ended_at, summary, memory jsonb), `agent_steps` (run_id, role, tool, input_hash, output_hash, model, status, duration_ms, cost_usd), `approvals` (action, scope, bundle, status, requester, reviewer), `provider_configs` (provider, name, base_url, default_model, healthy, last_check), `secret_metadata` (name, scope, env, last_rotated_at, owner — **no values**), `publish_targets`, `preview_sessions`, `runtime_logs`, `visual_checks` (route, viewport, screenshot_url, baseline_url, diff_pct, passed), `onboarding_flows`, `audit_events` (actor, action, target, env, before_hash, after_hash, approval_id, run_id, ip, ua), `user_preferences`.

**Supabase RLS**: every table has a tenant policy. Service-role key only in `/api`. Anon role in browser is read-restricted; writes go through `/api`.

**Vault** (`apps/api/src/security/vault.ts`)
- Master key in env (`VAULT_MASTER_KEY`, 32 bytes).
- Use `libsodium` `crypto_secretbox` to seal each secret value with a per-secret nonce stored alongside ciphertext in a separate `secret_values` table that is **only** readable by service role and **only** queried by the vault module.
- Vault exposes: `put(name, value, scope, env)`, `get(name, env)` (server-only), `rotate`, `list` (returns metadata, never values).
- Browser only ever sees `secret_metadata`.

**Audit** (`apps/api/src/security/audit.ts`): single `write(event)` function used by every sensitive route + tool. Include before/after content hashes, never raw values.

**Acceptance**: migrations apply cleanly to a fresh Supabase; RLS denies cross-tenant reads in tests; vault round-trips a value; metadata endpoint never returns ciphertext.

**Do not**: store secret values in any table other than `secret_values`. Do not log decrypted values. Do not return decrypted values to the browser.

---

### STEP 4 — Provider adapters + always-visible model control

**Adapter interface** (`packages/providers/types.ts`):
```ts
export interface ProviderAdapter {
  id: 'minimax' | 'ollama' | string;
  listModels(): Promise<{ id: string; label: string }[]>;
  healthcheck(): Promise<{ ok: boolean; latencyMs: number; detail?: string }>;
  chat(req: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<ChatChunk>;
  complete(req: CompleteRequest): Promise<CompleteResponse>;
  embed?(req: EmbedRequest): Promise<EmbedResponse>;
}
```

**MiniMax 2.7 adapter** (`apps/api/src/providers/minimax.ts`)
- API key fetched via `vault.get('minimax.api_key', env)`. Never read from `process.env` directly in the request path.
- Correct request shape per MiniMax 2.7 chat API; map `system/user/assistant`; pass `temperature/top_p/max_tokens`.
- Stream via SSE → re-emit to client as Realtime channel events.
- Surface clear errors: bad key, quota, network, model not found.
- Healthcheck = 1-token completion against a cheap model.

**Ollama adapter** (`apps/api/src/providers/ollama.ts`)
- `base_url` from `provider_configs`; default `http://localhost:11434`.
- `listModels` from `/api/tags`. `chat` via `/api/chat` with stream.
- Timeout configurable; surface in UI when hit.

**Registry**: `getAdapter(id)` returns adapter; `healthcheckAll()` for the Provider Settings screen.

**Front-end model control**
- `ModelSelector` lives in the LeftPanel header **and** in any "Run" confirmation dialog.
- State stored in `runStore` (zustand): `selectedProvider`, `selectedModel`. Persist per project.
- Every run request POSTs `{ provider, model, ... }`. Server validates + records on `agent_runs.model` and on every `agent_steps.model`.
- **No silent fallback.** A `fallbackEnabled` toggle exists per project, default OFF. When ON and used, the chat shows a yellow `Banner` ("Fell back from X to Y because Z") and an audit row is written.

**Acceptance**: switching model in UI changes the model used by the next run; recorded on the run row; healthcheck states render correctly; pulling network on MiniMax surfaces a clean error; with fallback OFF, a failing primary model fails the run with a clear message instead of switching.

**Do not**: route models behind the user. Do not return API keys to the browser. Do not log prompt/response bodies in `audit_events` (use `runtime_logs` with redaction instead).

---

### STEP 5 — App shell (collapsible left + dominant main)

**`apps/web/src/app/Shell.tsx`** layout:
- CSS Grid: `grid-template-columns: var(--left-w, 320px) 1fr;` with `--left-w: 0px` when collapsed (animated 180ms; respects reduced-motion).
- Top bar (single row): project switcher, env badge (Dev/Staging/Preview/Prod), global search, profile menu. **Not** a second navigation system.
- Left panel sections (each a collapsible group, persisted): Chat, Run History, Plan Summary, Approvals (badge), Target Context Chip, Agent Status, Model Selector.
- Collapse toggle lives in left panel header AND has keyboard shortcut (`Cmd/Ctrl+\`). On collapse, all state in the left panel is preserved (zustand stores survive unmount; chat messages remain in `chatStore`).
- Main workspace: `ModeTabs` across the top: `Preview | Code | Files | Console | Tests | Visual QA | Split`. Active mode fills the area. Split mode lets the user pick any two modes side-by-side using a `Resizable` primitive; layout persisted per project.

**Hierarchy rules** (enforce in code review):
- One primary action per screen.
- Spacing only from the scale.
- Surfaces: base background → elevated content → overlay. No borders-on-everything.
- Truncation tested with long titles, long file paths, long route names, long status text.

**Acceptance**: shell renders, collapse/reopen does not lose chat or run state; tab switches under 50ms; split persists across reload; passes axe; keyboard navigation reaches every control with visible focus.

**Do not**: build a 3-column layout. Do not put the AI panel on the right. Do not make the left panel overlap the main workspace.

---

### STEP 6 — Files, Monaco editor, snapshots, diffs, restore

**Files mode**
- Tree from `files` table (virtualized for large repos).
- Tabs with dirty state (`●`), save state (`✓`), unsaved-changes guard.
- Search across files (server-side ripgrep-equivalent through `/api/files/search`).
- Hover on a file → "impact summary": components/routes/services that import it.

**Monaco**
- Wrap with theme matching tokens; syntax for ts/tsx/js/jsx/json/sql/md/css.
- Multi-cursor, command palette (`Cmd/Ctrl+P` for files, `Cmd/Ctrl+Shift+P` for actions).
- Save = POST `/api/files/:id` with new content; server hashes, writes blob if new, updates `files.content_hash`, writes `audit_events`.

**Snapshots**
- Every save creates/links a `file_blobs` row by content hash.
- `versions` table snapshots the entire file→blob map at: every successful agent step, every save when the user clicks "Snapshot now", and **automatically before every autonomous run**.
- Restore = create a new snapshot pointing at the older blob set; never destructive.

**Diff viewer**
- Use Monaco diff editor.
- Agent edits surface as a "Proposed changes" tray inside the Code mode with per-file accept/reject + bulk accept.

**Acceptance**: open 100-file project; open/close 10 tabs; edit, save, restore; diff renders for an agent change; file search returns under 500ms on 5k files.

---

### STEP 7 — Preview/run on the worker sandbox

**Per-project preview**
- `apps/worker/src/preview.ts` serves project subdomain `https://<projectSlug>.preview.<rootDomain>`.
- Files synced to a KV/R2-backed virtual FS the worker reads.
- For React/Vite projects: pre-bundle in `/api` using esbuild → output served by worker. For server projects (Fastify/Hono): run in a Node sandbox container started by `/api` (Docker) and proxied through the worker.
- Process manager UI in Preview mode: dev server, preview server, backend services, workers — start/stop/restart with logs streaming to Console mode.
- Preview frame: device sizes (`360 / 768 / 1024 / 1280 / 1440`), route bar, reload, "open console" overlay, "screenshot" button.

**Acceptance**: a Blank project renders a Hello-World page in preview within 5s of "Boot"; console errors appear in Console mode in real time; killing the process turns the boot badge red with a specific reason.

**Do not**: run user code in the same process as `/api`. Do not give the worker access to vault.

---

### STEP 8 — Backend foundations (schemas, migrations, services, jobs, webhooks, integrations)

- **Schema editor**: GUI to define tables; generates Drizzle schema files into the user's project; "preview migration" produces SQL diff; "apply" runs against the chosen environment (dev allowed; staging/prod **requires approval**).
- **Migrations panel**: per-env list with status, applied_at, and a rollback action.
- **Services**: scaffold an HTTP service (Fastify route group) or a function with typed input/output; wire to the Tests mode.
- **Jobs/queues**: Upstash QStash bindings; a job is a typed handler + schedule (cron) + retry policy. UI shows queue depth, last run, last error.
- **Webhooks**: inbound webhook URL per project; signing secret stored in vault; inspector lists recent payloads with replay.
- **Integrations**: typed connection records; OAuth refresh tokens stored in vault; reconnection requires approval.
- **Env/Secrets metadata screen**: list secrets per env with last-rotated, owner, scope. Create/rotate/delete = approval-gated.

**Acceptance**: add a `users` table → preview migration → apply on dev → query in DB browser → expose `GET /users` service → call from API tester → see request trace in Logs; create a job that runs every minute and visibly executes; receive a webhook and replay it.

---

### STEP 9 — Agent system (roles, tools, orchestrator, memory, autonomy)

**Tool contracts** (`apps/api/src/agent/tools/*`) — each tool has Zod input/output, scope (which files/services it may touch), and produces structured output. Tools available per role:

| Role | Tools |
|---|---|
| Planner | `fs.read`, `db.query` (read-only), `verify.run` (read-only history) |
| Builder | `fs.read`, `fs.write` (scoped to plan's affected files), `fs.diff`, `shell.exec` (sandboxed) |
| Runtime | `preview.boot`, `preview.logs`, `verify.run` (lint/typecheck/build/unit) |
| Visual | `preview.screenshot`, `verify.run` (playwright + screenshotDiff) |
| Backend | `db.migrate` (dev only without approval), `db.query`, `verify.run` (integration/e2e/migrationSmoke), `integration.invoke` |
| Fixer | same as Builder, but each call must reference a specific finding id |
| Release | read-only across all; assembles `approvals` bundle |

**Orchestrator** (`apps/api/src/agent/orchestrator.ts`)
- Loop: `plan → identify affected files → small edit → run → inspect (runtime + visual + backend) → fix → re-verify → summarize`.
- Subtask graph persisted to `agent_steps`. Continue through errors; only stop on (a) genuine completion, (b) approval-required action, (c) hard blocker requiring human decision.
- Streams events over Supabase Realtime into the LeftPanel.

**Run memory** (`packages/agent-core/memory.ts`) — jsonb on `agent_runs.memory`:
```ts
{
  goal, constraints, model, affectedFiles[], decisions[],
  completedSubtasks[], remainingSubtasks[], knownBugs[], blockers[],
  verification[], screenshots[], nextActions[]
}
```
**Compactor** (`compactor.ts`) — when memory bytes > threshold, rewrite narrative noise but preserve every key above. Resumable.

**Autonomy controls** in LeftPanel during a run: Pause / Resume / Stop / Emergency Kill. Per-run budgets (max-step / max-time / max-cost). Restore point auto-created before every autonomous run. Conflict handling: if a human edits an open file, agent pauses that subtask and surfaces a conflict card with merge/abandon/replan.

**Acceptance**: kick off a run on a Blank project ("Add a /pricing page with 3 tiers"); orchestrator plans → builder writes scoped files → runtime boots → visual captures screenshots → tests green → run summary lists files changed and verifications passed; kill mid-run, restore point intact, resume preserves goal + affected files + completed subtasks.

---

### STEP 10 — Verification matrix

`packages/verify` adapters, orchestrated by `apps/api/src/verify/pipeline.ts`. Each adapter returns `{ ok, durationMs, summary, findings[] }`.

Adapters: `lint` (eslint), `typecheck` (tsc --noEmit), `build` (vite build / fastify bundle), `unit` (vitest), `integration` (vitest with test DB), `e2e` (Playwright with preview URL), `secretScan` (gitleaks-style regex from `packages/security/patterns`), `depVuln` (`pnpm audit --json`), `migrationSmoke` (apply against ephemeral DB, run a smoke query, rollback), `playwrightRuntime` (boot + console error scrape), `screenshotDiff` (capture vs baseline; baseline editable per route+viewport).

**Tests mode** UI: matrix table with last-run, status, duration, findings count, expand for output. "Run all" button + per-row run.

**Visual QA mode**: route×viewport grid; click a cell → screenshot + diff overlay + console at capture time. Editable baselines (with audit).

**Hard rule**: a task is **not** complete unless the matrix selected for that task type is green or each non-green item is explicitly skipped with a reason in the run summary.

**Acceptance**: inject a typo → typecheck fails the run; inject a blank route → playwrightRuntime + screenshotDiff fail; commit a fake API key → secretScan fails. All three appear in the Tests mode with actionable detail.

---

### STEP 11 — Approval matrix (server-enforced)

`apps/api/src/security/approvalMatrix.ts` decides whether an action requires approval. Inputs: `{ action, env, scope, scale }`. Outputs: `{ requiresApproval, reason, bundleSpec }`.

Required: production deploys; migration apply on staging/prod; secret create/rotate/delete; integration connect/reconnect; browser automation against live customer accounts; destructive deletes; broad rewrites (>configurable file/line thresholds); auth/permission model changes; publish to live; bulk outbound automation changes.

Not required: scoped implementation, debugging, local preview, test runs, dev-env migrations, screenshot QA.

**Approvals UI**: `ApprovalsQueue` in LeftPanel + full screen. Each approval shows: action, scope, diff, screenshots, verification results, requester, model used. Buttons: Approve / Reject / Request changes. All decisions audited.

**Acceptance**: triggering a production deploy without approval is rejected by the API even if the UI is bypassed; approval is required and surfaces the bundle.

---

### STEP 12 — Project types, websites, onboarding automation

**Project types registry** (`packages/project-types/index.ts`): each type exports `{ id, label, scaffold(input): FileTree, defaultVerificationMatrix, defaultApprovalPolicy, screens[] }`. Types: Website, Landing Page, Dashboard, Internal Tool, Onboarding Flow, Automation Control Panel, SaaS App, API Service, Full-Stack App, Blank.

**Website module**
- Multi-page site generation with reusable sections (Hero, Features, Logos, Pricing, FAQ, CTA, Footer, etc.).
- Local SEO page generator (city × service templating).
- Metadata editor (title, description, OG, Twitter, canonical, schema.org).
- Responsive preview (already in Preview mode).
- Asset manager (Supabase Storage; image optimization in worker).
- Style system (tokens scoped to the project).
- Publish/export (Cloudflare Pages, static export).

**Onboarding automation module** (own top-level screen)
- Flow builder (typed steps).
- Template-driven setup.
- Business intake form → drives generation.
- Brand/material intake (logo, colors, voice).
- Workflow/checklist surface.
- Safe account-setup workflows: every step that touches a customer-connected account is approval-gated and audited; rollback path required.
- Architecture leaves room for future GHL-style automation behind the same approval/audit layer.

**Acceptance**: scaffold a Website project → generate 3 pages + SEO page → preview at 360/768/1280 → publish to a Cloudflare Pages preview URL → metadata correct in `view-source`. Scaffold an Onboarding Flow → run an intake → produce a checklist → simulate a "connect account" step → approval gate triggers.

---

### STEP 13 — Operational surfaces

Wire (or stub with clear status) the following inside the main workspace as modes/sub-panels, **not** as new sidebars:
- Integrated terminal (xterm.js → sandboxed shell in `/api`).
- Process manager (already in Preview).
- Git import/clone, commit history, restore, branch/snapshot recovery.
- DB browser + table viewer + SQL editor.
- API tester.
- Function/server logs + request trace.
- Auth/session inspector + role/permission inspector.
- Webhook inspector + replay.
- Cron/scheduler.
- Jobs/queue monitor.
- Browser automation runner (Playwright; approval-gated against live customer accounts).

---

### STEP 14 — Polish: states, accessibility, responsive

Audit every screen against UI Playbook §13 + §14. Ensure for every important component:
- default / loading / empty / success / error / disabled / permission-limited / long-content / mobile-tablet states exist and look right.
- Keyboard nav reaches everything; focus visible; targets ≥ 32×32 (≥44 on touch).
- Reduced motion honored.
- No color-only state.
- No card soup. No multiple accents. No autoplay carousels.

---

### STEP 15 — Final verification (acceptance bar before "ready")

Run and report:
- `pnpm -w lint && pnpm -w typecheck && pnpm -w build` clean.
- Unit + integration + e2e green.
- Secret scan + dep vuln scan clean.
- Migration smoke green.
- Boot a Blank, a Website, a Full-Stack, an API Service, an Onboarding Flow project end-to-end.
- Verify each Non-Negotiable in §2.
- Manually walk every screen and tick the UI Playbook checklist.

If anything is skipped, list it explicitly with reason in the final report.

---

## 6. Coding Standards

- TypeScript strict everywhere. No `any` without an `// eslint-disable-next-line` and a comment.
- Zod at every boundary (HTTP, queue, tool I/O, env).
- Repository pattern for DB access; no direct `db.*` calls in routes.
- Never trust client-supplied `tenantId`, `role`, hidden fields. Derive from the authenticated session.
- Never `console.log` a secret; route logs through `redact()`.
- React: server-state via TanStack Query; UI-state via Zustand; no global "everything" store.
- Tests colocated `*.test.ts` next to source; e2e in `/e2e`.
- File header in every non-trivial source file: 1-line purpose comment.

---

## 7. Security Hard Rules (no exceptions)

- Secrets only in vault. Never in repo, env files committed to git, browser env, logs, screenshots, exports, or audit events.
- Server-side authz on every sensitive route.
- Free-form model output **cannot** directly perform sensitive actions. All such actions go through a typed action contract validated by `approvalMatrix`.
- Uploads/imports/notes/prompts/websites/screenshots/external content are untrusted and adversarial.
- Crown-jewel assets (provider keys, MiniMax creds, Ollama relay creds, DB connection strings, service-role keys, auth signing secrets, browser session state, OAuth refresh tokens, webhook signing secrets, deploy tokens, customer-connected creds) — vault only.
- Every sensitive action: previewable, approvable, logged, reversible.

---

## 8. Definition of Done (per task)

A task is done **only when**:
1. App boots cleanly.
2. Preview works.
3. The matrix selected for the task type is green or each non-green is explicitly skipped with reason.
4. The agent's run summary lists: files changed, verifications passed, screenshots captured, blockers (if any), next actions (if any).
5. No avoidable console errors.
6. No secrets in any artifact.

If any of these fail, the task is not done. Do **not** mark it complete.

---

## 9. Default State

Empty. No demo companies, projects, or seeded records. Real empty states (label + reason + next step). Seed data is allowed only in test fixtures.

---

## 10. Working Style

- Explain the plan before any major implementation.
- Work in small batches.
- Keep preview alive across changes.
- Test as you go.
- Keep changes scoped; reference affected files.
- Say exactly what changed, which files changed, what was verified, what still needs verification.
- Do not claim success without actual verification.

---

## 11. Required Env Vars (`.env.example`)

```
# Core
NODE_ENV=development
APP_URL=http://localhost:5173
API_URL=http://localhost:8787
WORKER_URL=http://localhost:8788
PREVIEW_ROOT_DOMAIN=preview.local.test

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # server only
SUPABASE_JWT_SECRET=

# Vault
VAULT_MASTER_KEY=              # 32-byte base64; server only

# Cloudflare
CF_ACCOUNT_ID=
CF_API_TOKEN=                  # server only
CF_PAGES_PROJECT=

# Upstash
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
UPSTASH_QSTASH_TOKEN=

# Providers (registered through UI; not required at boot)
# MINIMAX_API_KEY -> stored in vault, never in env in prod
# OLLAMA_BASE_URL=http://localhost:11434
```

---

## 12. Final Acceptance Checklist (verify before handing back)

- [ ] App boots cleanly.
- [ ] Preview works.
- [ ] Left AI panel collapses/reopens without losing chat / run / approval / target state.
- [ ] Main workspace dominates the screen.
- [ ] Preview / Code / Files / Console / Tests / Visual QA / Split each work.
- [ ] MiniMax 2.7 wired correctly (key in vault, healthcheck, no client exposure).
- [ ] Ollama wired correctly (base URL, model list, healthcheck, timeout).
- [ ] Selected model always visible; per-run pinning; recorded on run + steps.
- [ ] No hidden auto-routing; fallback opt-in and visibly banner-warned when used.
- [ ] Agent can plan / build / run / inspect / fix / compact / resume / summarize.
- [ ] Screenshot QA catches injected blank-route + overflow regressions.
- [ ] Console / runtime errors under control.
- [ ] Backend paths, schema changes, jobs, auth, APIs all function where required.
- [ ] Approval matrix enforced server-side (UI bypass attempts rejected).
- [ ] Audit rows written for every sensitive action.
- [ ] Secret scan + dep-vuln + migration-smoke part of the matrix and blocking.
- [ ] UI passes UI Playbook §13 review checklist; no §14 hard-bans present.
- [ ] Default state is empty (no fake demo data).
