# HANDOFF_NOTES — live progress log

> Updated by the building agent after each meaningful change. If you are
> picking this project up mid-build, read `HANDOFF.md` first (authoritative
> brief), then this file top-to-bottom for current state, then jump to
> "Where to resume" at the bottom.

---

## Current state (2026-05-09): Niche expansion Phase 1 COMPLETE — Phase 2 dispatched to SPS

The active multi-phase plan lives at `~/.claude/plans/eventual-leaping-petal.md`.
**Phase 1 (niche library expansion: 10 → 111 manifests) shipped clean.** Phase 2
handoff doc dispatched to SignalPointSystems. Phase 3 cross-platform glue is
gated on SPS write-back (see "OUTBOUND TO SPS" below).

### Final state — 111 niches on disk, 333 ad-copy patterns

- **Catalogue total: 111 niches** (10 original + 101 net-new across batches 1–12).
- **Ad-copy: 333 framework-shaped patterns** in `apps/api/src/routes/ads/copyPatterns.ts`,
  one block per niche × 3 frameworks (specific-value-prop / pattern-interrupt / before-after).
- **All commits green** through Phase 1; api production deploy rolled cleanly
  each commit (api at `https://api.40-160-3-10.sslip.io`).
- **Day 0 cross-cutting:** ABW `CLAUDE.md`, SPS `CLAUDE.md` session-start
  rule, `notify-handoff.ps1` toast script, and `apps/api/scripts/manifest-author-prompt.md`
  spec template — all in place from commit `2e741ba`.
- **Validation tooling:** `apps/api/scripts/validate-niche-batch.mjs` gated every
  batch — Zod schema check + slop-blocker on voice/image_directives/ad-copy +
  hex-format check on palettes.

### Phase 1 commit log

| Batch | Category | Niches | Commit |
|---|---|---|---|
| 0 | Day 0 cross-cutting | — | `2e741ba` |
| 1 | Marketing-doc | 8 | `ac7ab05` |
| 2 | Home-services umbrella + trades A | 13 | `6969cc0` |
| 3 | Home-services trades B | 12 | `6f3172d` |
| — | Mid-session checkpoint | — | `9a39374` |
| 4 | Auto | 9 | `900648b` |
| 5 | Food + drink | 6 | `180b922` |
| — | Mid-session checkpoint | — | `080af9c` |
| 6 | Fitness | 7 | `5f991b6` |
| 7 | Health (trimmed) | 5 | `3381f37` |
| 8 | Beauty | 10 | `ae4a84f` |
| 9 | Pets | 5 | `9e617d2` |
| 10 | Events | 6 | `c89e20b` |
| 11 | Retail | 9 | `d999d0c` |
| 12 | Education + Professional | 11 | `3e6c1c3` |

**Total: 12 batches, 101 net-new niches, all batches passed validate +
typecheck + build, all pushes rolled cleanly.**

### Trigger collisions noted (planner SOP follow-up if needed)

- `crossfit-box` has bare `"crossfit"` trigger that overlaps with the existing
  `gym-fitness` manifest (which is in scope-locked-as-is per the plan). The
  more-specific phrase trigger `"crossfit box"` wins by length under the
  planner's longest-match scan. If the planner ever picks the wrong niche on
  ambiguous prompts, add a tie-breaker paragraph to
  `apps/api/src/agent/skills/planners/website.md`.
- `personal-training` similarly has bare `"personal trainer"` overlap with
  `gym-fitness` — same resolution.

### Phase 1 wrap (deferred — single commit when picked up)

Per the plan, the user-guide updates ship as one final Phase 1 commit:
- **Trim §12 prompt cookbook** to 4–5 representative pattern examples
  (specific-value-prop / pattern-interrupt / before-after) on a few niches.
- **Add §13 "Niche catalogue"** — compact 3-page table of all 111 niches:
  slug, label, 3–5 key trigger words. Reader connects their own prompt to
  the relevant niche by spotting matching keywords.
- **Renumber:** old §13 Tips → §14, old §14 Glossary → §15. Update TOC.
- **Re-render PDF** via `node render-pdf.mjs` from
  `C:/Users/telly/OneDrive/Desktop/SignalPoint-Docs/`.

This is intentionally not done yet — the source `user-guide.html` lives in a
separate directory and the PDF re-render step needs the SignalPoint-Docs
project context. Do this in a focused session.

---

## OUTBOUND TO SPS — 2026-05-09

**Phase 2 handoff doc dispatched.** Dropped at
`C:/Users/telly/OneDrive/Desktop/SignalPointSystems/handoff/INBOUND_FROM_ABW_2026-05-09.md`
on 2026-05-09. SPS's CLAUDE.md (cross-cutting Day 0 commit) instructs the
SPS session to check `handoff/INBOUND_FROM_*.md` on session start.

**Optional notification:** run
`pwsh "C:/Users/telly/OneDrive/Desktop/AI Ops/scripts/notify-handoff.ps1"`
to fire a Windows toast pointing the user at the SPS Claude session.

**Phase 3 is gated on SPS write-back.** When SPS finishes its work, its agent
appends an `## INBOUND FROM SPS — <date>` section to this file with deployed
migration IDs, embed-edge endpoint URL, and the workspace anon-key location.
Phase 3 then becomes safe to start — see plan §3 for the work breakdown.

### Phase 3 (after SPS writes back): Cross-platform glue

Plan §3 — opt-in `signalpoint_systems` / `vertical_kind` / `site_data_bindings`
fields on NicheManifest, new `packages/site-data` workspace package, code-gen
hook in `runPhases.ts`, signalpoint-config flow in publish handler. Hard rule:
zero regression on standalone-IDE behavior — verified by integration test
that builds a no-config project and asserts zero `signalpoint` strings in
the bundle.

---

## Quick reference for the next agent

- Brief (authoritative): `HANDOFF.md`
- Build order & acceptance: `HANDOFF.md` §5 (Steps 1–15)
- Non-negotiables: `HANDOFF.md` §2
- Definition of Done: `HANDOFF.md` §8
- Governing UI rules: `C:/Users/telly/OneDrive/Documents/Ui Playbook For Ai Agents.pdf`
- Governing security: `C:/Users/telly/OneDrive/Desktop/SignalPoint_Systems_Master_Blueprint.pdf`
  and `…/SignalPoint_Systems_Exhaustive_Build_Plan.pdf`

### Repo facts
- Root: `C:\Users\telly\OneDrive\Desktop\AI Ops\AI Builder Workspace`
- Package manager: **pnpm 9** (monorepo) + **turborepo**
- Node: 20.11+ (`.nvmrc` present)
- Workspace glob: `apps/*`, `packages/*`
- Path aliases: `@abw/ui`, `@abw/agent-core`, `@abw/providers`, `@abw/project-types`,
  `@abw/publish`, `@abw/security`, `@abw/db`, `@abw/verify`, `@abw/shared`
- CSS alias for Vite: `@ui-styles` → `packages/ui/styles/` (avoids Windows path-with-spaces bug)
- CI: `.github/workflows/ci.yml` runs lint / typecheck / build / unit / secret-scan / dep-vuln

### Conventions to keep
- TypeScript strict everywhere; Zod at every boundary.
- Spacing tokens only from `4 / 8 / 12 / 16 / 24 / 32 / 40`.
- Single accent color. Never communicate state with color alone.
- CSS class namespace: `.abw-*` everywhere in the UI.
- Secrets server-side only. Browser never receives secret values.
- Repository pattern for DB access; no `db.*` calls in routes.
- Every non-trivial file starts with a 1-line purpose comment.

---

## Progress log (reverse chronological)

### [Step 7] Preview/run on worker sandbox — INFRASTRUCTURE COMPLETE ✅

**Deliverables completed**
- [x] `apps/worker/src/sandbox.ts` — `parseProjectSlug()` (subdomain or `?project=` fallback), `assetKey()`, `listProjectAssets()`
- [x] `apps/worker/src/edge.ts` — `applyEdgeHeaders()` (CSP, cache-control, CORS), `mimeFromPath()` (25 types)
- [x] `apps/worker/src/preview.ts` — full KV-backed VFS worker:
  - Slug-based project isolation
  - SPA fallback (extensionless paths → index.html)
  - Boot placeholder HTML with pulse animation when KV not populated
  - Security headers on every response
- [x] `apps/worker/wrangler.toml` — KV namespace binding declaration (`PREVIEW_KV`)
- [x] `apps/api/src/preview/bundler.ts` — esbuild-based project bundler:
  - `bundleProject()` for `react-vite`, `vanilla`, `static` frameworks
  - Static file collector (`collectStaticFiles`)
  - All loaders (tsx/ts/jsx/js/css/svg/png/jpg/gif/woff/woff2)
  - `process.env.NODE_ENV` define
  - Returns `Map<string, Uint8Array>` (in-memory, no disk write)
  - Secrets redacted from build warnings/errors
- [x] `apps/api/src/preview/sessionManager.ts` — in-process session registry:
  - `createSession`, `getSession`, `listSessions`, `updateSession`, `stopSession`, `deleteSession`
  - `appendLog`, `getLogs` with 2000-entry cap
  - `SessionStatus` state machine: queued → bundling → syncing → booted | error | stopped
- [x] `apps/api/src/routes/preview.ts` — preview REST API:
  - `POST /api/preview/boot` — async bundle + KV sync, returns `{ sessionId, previewUrl }`
  - `POST /api/preview/stop` — stop session
  - `GET /api/preview/sessions` — list tenant sessions
  - `GET /api/preview/logs?sessionId=…&after=…` — poll logs
  - `DELETE /api/preview/sessions/:id` — evict
  - `syncAssetsToKV()` — Cloudflare KV bulk PUT via REST API (skipped gracefully when CF credentials missing)
- [x] `apps/web/src/lib/store/previewStore.ts` — session state + log buffer (2000-entry cap)
- [x] `apps/web/src/features/preview/ProcessManager.tsx` — process manager toolbar:
  - Boot/Stop buttons with correct disabled states
  - Per-process pills with status dots
  - Busy spinner for bundling/syncing states
- [x] `apps/web/src/layout/MainWorkspace/modes/PreviewMode.tsx` — full implementation:
  - ProcessManager row above toolbar
  - Real iframe (sandbox attrs, allow clipboard)
  - URL bar synced to `currentRoute`
  - Viewport picker (360/768/1024/1280/1440/Full) with active state
  - Smooth iframe width transition
  - Boot/error/loading empty states
  - Async boot + log polling (2s interval, 60 retries max)
- [x] `apps/web/src/layout/MainWorkspace/modes/ConsoleMode.tsx` — full implementation:
  - Reads from `previewStore.logs`
  - Per-line: timestamp (HH:MM:SS.mmm), level colour-coded, source badge, message
  - Auto-scroll to latest entry
  - Clear button
  - Session status header

**Acceptance: PASSED (infrastructure level) ✅**
- 19/19 workspace typecheck clean
- 12/12 workspace build clean
- Live UI: Process manager (`▶ Boot` button + `No processes`), URL bar (`—`), 6 viewport buttons
- Console mode: `role="log"`, Clear button, correct empty state
- Zero console errors

**Not yet wired (requires Cloudflare KV + running API)**
- Real boot round-trip: requires `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_KV_PREVIEW_NAMESPACE_ID` env vars
- Real project rootDir on disk (currently stub path `/tmp/preview-stub`)
- Supabase Realtime push for log streaming (currently HTTP poll); wired in Step 9
- Process PID tracking for Node sandboxes (Docker); wired in Step 13

---

### [Step 6] Files, Monaco editor, snapshots, diffs, restore — INFRASTRUCTURE COMPLETE ✅

**Deliverables completed**
- [x] `apps/web/src/lib/store/editorStore.ts` — tab state (open/close/active/dirty/saving/markSaved); `isTabDirty()` helper
- [x] `apps/web/src/features/editor/languageFromPath.ts` — maps 25 file extensions to Monaco language IDs
- [x] `apps/web/src/features/editor/EditorTabs.tsx` — tab bar with dirty indicator (●), saving indicator (…), close button with unsaved-changes guard
- [x] `apps/web/src/features/editor/MonacoEditor.tsx` — Monaco wrapper:
  - Theme matched to design tokens (dark, violet cursor/selection)
  - Cmd+S → save handler
  - Cmd+P → dispatches `abw:open-file-palette` custom event
  - Cmd+Shift+P → Monaco command palette
  - Per-file undo history via `path` prop
  - All display options: no minimap, gutter, smooth scrolling, font ligatures
- [x] `apps/web/src/features/editor/DiffViewer.tsx` — Monaco diff editor:
  - `DiffViewer` component: per-file diff with Accept/Reject buttons
  - `ProposedChangesTray` component: bulk Accept all / Reject all tray that slides up from the bottom of Code mode
- [x] `apps/web/src/features/files/FileTree.tsx` — keyboard-navigable file tree:
  - Expand/collapse dirs; keyboard: Enter/Space/ArrowRight/ArrowLeft
  - File type icons (ts/tsx/css/json/md etc.)
  - Dirty indicator on open files in the tree
  - `filterNodes()` for search filtering
- [x] `apps/web/src/layout/MainWorkspace/modes/FilesMode.tsx` — updated:
  - Search input (live filter)
  - FileTree with stub project structure
  - Impact summary footer (placeholder)
- [x] `apps/web/src/layout/MainWorkspace/modes/CodeMode.tsx` — updated:
  - EditorTabs + MonacoEditor + ProposedChangesTray
  - Correct empty state when no tabs open
  - Stub save (150ms delay → markSaved); real API wiring below
- [x] `apps/api/src/db/repositories/filesRepo.ts` — repository layer:
  - `listFiles(projectId, tenantId)` — metadata only
  - `getFileContent(fileId, tenantId)` — resolves blob by hash
  - `saveFile(input)` — SHA-256 hash → upsert blob → update file record
  - `searchFiles(projectId, tenantId, query)` — ILIKE on path, top 50
  - `createSnapshot(projectId, tenantId, createdBy, label?)` — builds file→blob manifest
  - `listSnapshots(projectId, tenantId)` — newest first
  - `restoreSnapshot(versionId, ...)` — creates new snapshot pointing at old blobs (never destructive)
- [x] `apps/api/src/routes/files.ts` — `GET /api/files`, `GET /api/files/:id/content`, `POST /api/files/:id`, `GET /api/files/search`
- [x] `apps/api/src/routes/versions.ts` — `GET /api/versions`, `POST /api/versions`, `POST /api/versions/restore`
- [x] `apps/api/src/server.ts` — registers `filesRoutes` + `versionsRoutes`

**Acceptance: PASSED (infrastructure level) ✅**
- 19/19 workspace typecheck clean
- 12/12 workspace build clean
- Live UI confirmed: Code mode shows "No file open" empty state; Files mode shows search + tree (src/, package.json, vite.config.ts)
- Zero console errors

**Not yet wired (requires running Supabase + real project)**
- File tree populated from API (currently uses stub); wired when real project management is added
- Actual file content load from API on tree click (stub: inserts template comment)
- Real save POSTs to API (currently 150ms stub delay)
- File search using server-side endpoint (currently all client-side filter on stub tree)
- Snapshot creation on agent steps (Step 9)

---

### [Step 5] App shell (collapsible left + dominant main) — COMPLETE ✅

**Deliverables completed**
- [x] Zustand stores (persist to localStorage where appropriate):
  - `apps/web/src/lib/store/shellStore.ts` — collapsed, activeMode, splitLayout
  - `apps/web/src/lib/store/runStore.ts` — selectedProvider, selectedModel, activeRun, fallbackEnabled (default OFF)
  - `apps/web/src/lib/store/chatStore.ts` — messagesByProject keyed by projectId; survives collapse
- [x] Shell CSS: `apps/web/src/styles/app.css`
  - CSS Grid: `grid-template-columns: var(--left-panel-w, 300px) 1fr`; `grid-template-rows: 36px 1fr`
  - `.abw-shell--collapsed` sets `--left-panel-w: 0px` with 180ms transition
  - Full set of `.abw-*` classes for top bar, left panel, workspace, chat, preview, agent status, model selector
- [x] `apps/web/src/app/Shell.tsx` — CSS Grid layout; keyboard shortcut `Cmd/Ctrl+\` toggles collapse
- [x] `apps/web/src/layout/TopBar/TopBar.tsx` — collapse btn, project switcher, env badge, search, profile
- [x] `apps/web/src/layout/LeftPanel/LeftPanel.tsx` — panel with chat, run history/plan/approvals stubs, agent status, model selector
- [x] `apps/web/src/layout/LeftPanel/ChatThread.tsx` — empty state, message list, input (Enter to send, Shift+Enter newline), stub echo response
- [x] `apps/web/src/layout/LeftPanel/AgentStatus.tsx` — animated pulse dot for running states; respects `prefers-reduced-motion`
- [x] `apps/web/src/layout/LeftPanel/ModelSelector.tsx` — always-visible; shows provider + model; selects from static list; real list wired in Step 4 API/Step 9 runs
- [x] `apps/web/src/layout/MainWorkspace/Workspace.tsx` — main area with mode routing
- [x] `apps/web/src/layout/MainWorkspace/ModeTabs.tsx` — 7 tabs with ARIA roles (tablist/tab/tabpanel)
- [x] Mode components:
  - `PreviewMode.tsx` — toolbar (reload/URL/viewport buttons/screenshot), boot empty state with CTA
  - `CodeMode.tsx`, `FilesMode.tsx`, `ConsoleMode.tsx`, `TestsMode.tsx`, `VisualQAMode.tsx` — labeled empty states
  - `SplitMode.tsx` — two-pane layout with per-pane mode picker; layout persisted in shellStore
- [x] `apps/web/src/main.tsx` — updated to render `<Shell />` with `app.css` import

**Acceptance: PASSED ✅**
- `pnpm --filter @abw/web typecheck` → clean (0 errors)
- `pnpm --filter @abw/web build` → clean (62 modules, 27KB CSS, 167KB JS)
- Live accessibility snapshot confirms: all 7 tabs, collapse button, model selector (Ollama/Llama 3), chat empty state, agent status, preview toolbar
- Zero server-side console errors

**Fixes made during Step 5**
- Zustand `persist` middleware required explicit `persist<StateType>()` generic form; `partializes` → `partialize` (correct Zustand 4.x API)
- `appendToLast` in chatStore: guarded `prev[prev.length - 1]` for `noUncheckedIndexedAccess`
- CSS `@import` with relative paths (`../../../`) fails on Windows when parent directories contain spaces. Fixed by adding `@ui-styles` alias in `vite.config.ts` → `packages/ui/styles/` and using `@import '@ui-styles/globals.css'` in `app.css`.
- Dev server port conflict (5173 held by external process): switched to port 5175 with `strictPort: false`

**State of stubs (wired in later steps)**
- Chat input sends stub echo; real streaming via Supabase Realtime wired in Step 9
- Run History, Plan Summary, Approvals sections are labeled placeholders; wired in Steps 9 and 11
- Model list is static; real `/api/providers/models` endpoint wired in Step 4 API route (to do)
- `Boot preview` button is a stub; real boot wired in Step 7

---

### [Step 4] Provider adapters + always-visible model control — COMPLETE ✅

**Deliverables completed**
- [x] `packages/providers/types.ts` — `ProviderAdapter` interface, all request/response types
- [x] `packages/providers/index.ts` — re-exports all shared types
- [x] `apps/api/src/providers/minimax.ts` — MiniMax 2.7 adapter (vault key fetch, SSE streaming, healthcheck)
- [x] `apps/api/src/providers/ollama.ts` — Ollama adapter (model listing from /api/tags, NDJSON streaming, configurable timeout)
- [x] `apps/api/src/providers/registry.ts` — `getAdapter`, `healthcheckAll`, `assertNoAutoRoute`

**Key design**
- MiniMax key fetched via `vault.get('minimax.api_key', env)` — NEVER from process.env in the request path
- `assertNoAutoRoute()` throws if any code tries to silently fall back to a different provider
- Healthcheck = 1-token completion; surfaces latency + any error message
- No provider keys ever returned to the browser

---

### [Step 3] Database schema, RLS, audit, vault — COMPLETE ✅

**Deliverables completed**
- [x] `packages/db/schema/` — all Drizzle tables:
  - `core.ts`: tenants, users, memberships
  - `projects.ts`: projects, files, fileBlobs, versions, components, pages, routes, services
  - `backend.ts`: schemas, migrations, jobs, webhooks, webhookPayloads, assets, brandKits, templates
  - `agent.ts`: agentRuns, agentSteps, approvals, visualChecks, runtimeLogs
  - `ops.ts`: providerConfigs, secretMetadata, secretValues, publishTargets, previewSessions, onboardingFlows, auditEvents, userPreferences
- [x] `packages/db/index.ts` — barrel export
- [x] `apps/api/src/security/vault.ts` — libsodium sealed-box vault (vaultPut, vaultGet, vaultRotate, vaultList, vaultDel, vaultRef, generateSecret)
- [x] `apps/api/src/security/audit.ts` — `writeAuditEvent()` (content hashes only, never raw values)
- [x] `apps/api/src/security/authz.ts` — `getAuthContext`, `requireRole`, `authMiddleware`
- [x] `apps/api/src/security/redact.ts` — `redactString`, `redactObject` (pattern + key-name based)
- [x] `infra/supabase/sql/0001_rls_baseline.sql` — RLS policies

**Key design decisions**
- `secretValues` is a SEPARATE table from `secretMetadata`. Browser queries never touch `secretValues`.
- `auditEvents.approvalId` is a plain uuid column (no Drizzle self-ref relation) — FK enforced at DB level
- Vault uses `libsodium-wrappers` `crypto_secretbox_easy`; per-secret nonce stored alongside ciphertext

---

### [Step 2] Design tokens & UI primitives — COMPLETE ✅

**Deliverables completed**
- [x] Token files in `packages/ui/tokens/`:
  - `spacing.ts` — 4/8/12/16/24/32/40 scale (no other values)
  - `color.ts` — neutral (10 steps) + single violet accent + semantic success/warning/error/info
  - `type.ts` — Display/H1/H2/H3/Body/BodySm/Label/Caption with size/lineHeight/weight
  - `radius.ts` — field(6px)/button(6px)/card(10px)/popover(8px)/pill(9999px)
  - `elevation.ts` — base/elevated/overlay shadows
  - `motion.ts` — fast(120ms)/base(180ms)/slow(240ms) + prefers-reduced-motion support
- [x] CSS custom properties in `packages/ui/styles/variables.css` (dark mode via media query)
- [x] Global resets + `.sr-only` in `packages/ui/styles/globals.css`
- [x] All `.abw-*` component classes in `packages/ui/styles/primitives.css`
- [x] React components in `packages/ui/primitives/`: Button, Input, Textarea, Select, Tabs, Dialog, Popover, Tooltip, Menu, ScrollArea, Resizable, Skeleton, Banner, Badge, Chip, Kbd
- [x] Pattern components in `packages/ui/patterns/`: PageHeader, EmptyState, ErrorState, LoadingState, PermissionGate, SectionDivider
- [x] `packages/ui/index.ts` — full barrel export

**Key design decisions**
- CSS custom properties approach (no CSS-in-JS runtime overhead)
- `.abw-*` class namespace avoids conflicts with user project styles
- All Radix primitives are headless; all visual styling is in `.css` files

---

### [Step 1] Repo, tooling, base config — COMPLETE ✅

**Deliverables completed**
- [x] pnpm workspace + turborepo scaffold
  - Root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
- [x] ESLint + Prettier + lint-staged config
  - `.eslintrc.cjs`, `.prettierrc`, `.prettierignore`, `.editorconfig`, `.nvmrc`
- [x] Per-workspace `package.json` + `tsconfig.json` for every app and package
  - apps: `web` (Vite+React+Monaco), `api` (Fastify+Drizzle), `worker` (Cloudflare)
  - packages: `ui`, `agent-core`, `providers`, `project-types`, `publish`, `security`,
    `db`, `verify`, `shared`
  - every package has a `index.ts` placeholder so typecheck passes on empty scaffold
- [x] Minimal boot entry points
  - `apps/web/src/main.tsx` — renders the real Shell (updated in Step 5)
  - `apps/api/src/server.ts` — Fastify `/healthz`
  - `apps/worker/src/preview.ts` — worker `/healthz`
- [x] Env templates: `infra/env/.env.example`, `infra/env/.env.local.example`
- [x] Infra scaffolds: supabase, cloudflare, upstash
- [x] Secret-scan script `scripts/secret-scan.mjs`
- [x] CI workflow `.github/workflows/ci.yml`
- [x] Root `README.md`

**Acceptance: PASSED ✅**
- `pnpm -w lint`, `pnpm -w typecheck`, `pnpm -w build` all clean
- `node scripts/secret-scan.mjs` → clean

**Fixes made during Step 1**
- Removed `references: []` from `apps/web/tsconfig.json` (use path aliases + Vite aliases instead)
- Added explicit `paths` to `apps/web/tsconfig.json` and `apps/api/tsconfig.json`
- Set `noEmit: true` on api tsconfig
- Fixed `ScrollArea.tsx` `dir` prop conflict with Radix types
- Fixed `auditEvents` circular self-reference (plain uuid column, not Drizzle relation)

---

## Progress log (reverse chronological, continued)

### [Step 8] Backend foundations — COMPLETE ✅

**Deliverables completed**
- [x] `apps/api/src/routes/projects.ts` — project CRUD (list/get/create/patch/soft-delete); admin required for delete
- [x] `apps/api/src/routes/secrets.ts` — secret metadata management; production secrets gate (`requiresApproval: true`); uses vault functions
- [x] `apps/api/src/routes/jobs.ts` — job CRUD + trigger + PATCH; schema matches `jobs` table (handler/cron/config JSON); Upstash QStash TODO stub
- [x] `apps/api/src/routes/webhooks.ts` — webhook CRUD; signing secret auto-generated + stored in vault; payload inspector; replay endpoint; inbound receiver at `/inbound/:urlPath` with HMAC verification
- [x] `apps/api/src/routes/db.ts` — schema editor endpoints (CRUD on `schemas`); migration endpoints (create/preview/apply/rollback); staging+prod apply require `approvalId` (gate enforced, Step 11 wires decision)
- [x] `apps/api/src/server.ts` — all 8 route groups registered
- [x] TanStack Router v1 wired: `apps/web/src/app/Router.tsx` (root + 5 routes), `main.tsx` uses `RouterProvider`
- [x] `apps/web/src/app/Shell.tsx` — updated to accept `children` (Router's `<Outlet />`); `<main>` wrapper lives here
- [x] `apps/web/src/layout/TopBar/TopBar.tsx` — nav links (Workspace / Database / Jobs / Secrets / Providers); `useRouterState` for active state
- [x] `apps/web/src/screens/EnvSecretsScreen.tsx` — env-tabbed secret metadata table; production approval banner; create dialog with vault notice
- [x] `apps/web/src/screens/JobsQueuesScreen.tsx` — job list with status dots, cron display, trigger/toggle controls, queue depth callout
- [x] `apps/web/src/screens/DatabaseSchemaScreen.tsx` — Schema view (sidebar table list + column editor) + Migrations view (env filter, SQL expand, apply/rollback, approval gate banner)
- [x] `apps/web/src/screens/ProviderSettingsScreen.tsx` — MiniMax + Ollama cards; healthcheck; vault notice for API keys; no-silent-fallback banner
- [x] `apps/web/src/screens/AppSettingsScreen.tsx` — theme, default provider, danger zone
- [x] `packages/ui/styles/screens.css` — all screen-level CSS classes (.abw-screen, .abw-table, .abw-card, .abw-dialog-backdrop, .abw-db-layout, .abw-topbar__nav, .abw-provider-list, etc.)
- [x] `packages/ui/styles/variables.css` — added `--success-500`, `--warning-500`, `--error-500`, `--error-300` aliases + `--surface-code`

**Acceptance: PASSED ✅**
- 19/19 monorepo typecheck clean
- All 5 routes verified live: `/` (Workspace), `/env-secrets` (4 env tabs, secrets table), `/jobs` (3 rows, queue callout), `/database` (schema sidebar + migrations tab), `/providers` (2 provider cards + fallback banner)
- Nav link active state updates correctly on route change
- Shell collapse / left panel survive route navigation
- Zero TS errors, zero runtime errors

**Approval gates in place (enforced server-side)**
- Production secret create/rotate/delete → `requiresApproval: true` in response
- Migration apply on staging/prod → requires `approvalId` in request body (400 without it)
- Full decision engine wired in Step 11

---

### [Step 9] Agent system — INFRASTRUCTURE COMPLETE ✅

**Deliverables completed**
- [x] `packages/agent-core/types.ts` — Run, Step, Tool, Finding, Verification, RunMemory, RunBudget, RunEvent types
- [x] `packages/agent-core/contracts.ts` — Zod I/O contracts for all 10 tools + `TOOL_CONTRACTS` map
- [x] `packages/agent-core/memory.ts` — `deserializeMemory`, `serializeMemory`, mutation helpers (addDecision, addBug, markSubtaskComplete, etc.), `COMPACTION_THRESHOLD_BYTES`
- [x] `packages/agent-core/compactor.ts` — `maybeCompact` / `forceCompact` — shrinks completed subtasks, old decisions, fixed bugs while preserving all structural keys
- [x] `packages/agent-core/budget.ts` — `checkBudget`, `consumeStep`, `budgetSummary`, `formatViolation`
- [x] `packages/agent-core/index.ts` — barrel export
- [x] `apps/api/src/agent/tools/fs.read.ts` — DB blob-store first, disk fallback, path traversal blocked
- [x] `apps/api/src/agent/tools/fs.write.ts` — scope enforcement (affectedFiles), content-addressed blob write, audited
- [x] `apps/api/src/agent/tools/fs.diff.ts` — unified diff (built-in only, no external dep); compares vs HEAD snapshot or empty baseline
- [x] `apps/api/src/agent/tools/shell.exec.ts` — allowlisted commands, sanitized env (blocks VAULT_MASTER_KEY etc.), timeout, no shell=true
- [x] `apps/api/src/agent/tools/verify.run.ts` — delegates to Step 10 pipeline (stub returns skipped for now)
- [x] `apps/api/src/agent/tools/preview.boot.ts` — creates session + async bundle; returns immediately with `status: 'booting'`
- [x] `apps/api/src/agent/tools/preview.screenshot.ts` — validates session booted; Playwright/Storage stub returns placeholder URL
- [x] `apps/api/src/agent/tools/db.query.ts` — read-only guard (SELECT/WITH/EXPLAIN only); uses platform DB as proxy (per-project DB wired in Step 13)
- [x] `apps/api/src/agent/tools/db.migrate.ts` — dev-only without approval; audited; Step 13 wires per-project DB
- [x] `apps/api/src/agent/tools/integration.invoke.ts` — audited stub; real adapters in Step 13
- [x] `apps/api/src/agent/roles/index.ts` — `ROLES` map, `isToolAllowed`, `assertToolAllowed`
- [x] `apps/api/src/agent/runMemory.ts` — `loadMemory`, `saveMemory` (with compaction), `patchMemory`
- [x] `apps/api/src/agent/orchestrator.ts` — `Orchestrator` class:
  - Main loop: plan → subtasks → builder → runtime → summarize
  - Autonomy: `pause()`, `resume()`, `stop()`, `kill()` signals
  - Budget enforced before every step; auto-snapshot restore point before run
  - Events streamed via `emit()` callback (Realtime broadcast wired in Step 13)
  - `createRun()` factory: inserts `agent_runs` row, returns Orchestrator
- [x] `apps/api/src/routes/runs.ts` — REST API: start/pause/resume/stop/kill; GET runs + steps; in-process orchestrator registry
- [x] `apps/api/src/server.ts` — `runsRoutes` registered
- [x] `apps/web/src/lib/store/runStore.ts` — added `pauseRun`, `resumeRun`, `stopRun`, `killRun` actions (fetch to API + optimistic state)
- [x] `apps/web/src/layout/LeftPanel/AgentStatus.tsx` — real autonomy controls: Pause/Resume/Stop/Kill buttons; only shown when `activeRun` exists; pulse dot for running states

**Acceptance: PASSED ✅**
- 19/19 monorepo typecheck clean (all packages)
- Frontend renders cleanly: shell, workspace, agent status, model selector — zero console errors
- No external `diff` package needed — implemented built-in unified diff
- Schema field names corrected: `initiatedBy`, separate `provider`/`model`, `maxSteps`/`maxTimeSec`/`maxCostUsd`

**Stubs to wire in later steps**
- Real provider call in `planPhase` + `builderStep` (Step 4 final wiring)
- Real verify pipeline in `verify.run.ts` (Step 10)
- Real Playwright screenshot + Supabase Storage upload (Step 10)
- Supabase Realtime event broadcast from orchestrator (Step 13)
- Per-project DB connection in `db.query` and `db.migrate` (Step 13)
- ChatThread → run streaming subscription (Step 13)

---

---

### [Step 10] Verification matrix — COMPLETE ✅

**Deliverables completed**
- [x] `packages/security/patterns.ts` — SECRET_PATTERNS (12 regexes: generic API key, AWS, GitHub, Stripe, Supabase JWT, vault key, CF token, password, PEM, MiniMax, Upstash), IGNORE_PATHS list, `scanLines()` function
- [x] `packages/security/index.ts` — exports `patterns.ts`
- [x] `apps/api/src/verify/types.ts` — `AdapterResult`, `AdapterContext`, `AdapterFinding`, `VerifyPipelineResult`
- [x] `apps/api/src/verify/adapters/lint.ts` — ESLint JSON output parser; error/warning findings; fixable flag
- [x] `apps/api/src/verify/adapters/typecheck.ts` — tsc --noEmit; parses `file(line,col): error TSxxxx:` format
- [x] `apps/api/src/verify/adapters/build.ts` — detects vite.config.ts vs tsconfig fallback; runs build
- [x] `apps/api/src/verify/adapters/unit.ts` — Vitest JSON reporter; parses pass/fail per test
- [x] `apps/api/src/verify/adapters/integration.ts` — DB connectivity probe; finds `*.integration.test.ts` files
- [x] `apps/api/src/verify/adapters/e2e.ts` — Playwright JSON reporter; `PLAYWRIGHT_BASE_URL` injection
- [x] `apps/api/src/verify/adapters/secretScan.ts` — walks project files; uses `scanLines()`; skips >1MB files
- [x] `apps/api/src/verify/adapters/depVuln.ts` — `pnpm audit --json`; fails on critical/high
- [x] `apps/api/src/verify/adapters/migrationSmoke.ts` — Drizzle `sql` template; requires `SUPABASE_TEST_DB_URL`
- [x] `apps/api/src/verify/adapters/playwrightRuntime.ts` — dynamic import (optional dep); console error scrape; blank screen + overflow detection
- [x] `apps/api/src/verify/adapters/screenshotDiff.ts` — dynamic import; multi-viewport capture; DB baseline compare; visual_checks upsert
- [x] `apps/api/src/verify/pipeline.ts` — `runPipeline()` sequential adapter runner; `DEFAULT_ADAPTERS` / `FULL_ADAPTERS` presets; `onResult` callback
- [x] `apps/api/src/agent/tools/verify.run.ts` — now delegates to real pipeline (no longer a stub)
- [x] `apps/api/src/routes/tests.ts` — `POST /api/tests/run`, `GET /api/tests/results`, `POST /api/tests/baseline`
- [x] `apps/api/src/server.ts` — `testsRoutes` registered
- [x] `apps/web/src/layout/MainWorkspace/modes/TestsMode.tsx` — full matrix table: 11 adapter rows, status badge, duration, findings count, expandable findings, "Run all" + per-row run
- [x] `apps/web/src/layout/MainWorkspace/modes/VisualQAMode.tsx` — route × viewport grid (3×4=12 cells), detail panel with baseline promotion, `abw-vqa-*` CSS classes
- [x] `packages/ui/styles/screens.css` — `.abw-tests-mode-*`, `.abw-vqa-*`, `.abw-btn--xs` classes

**Acceptance: PASSED ✅**
- 19/19 monorepo typecheck clean
- Tests mode: 11 rows (ESLint / TypeScript / Build / Unit tests / Integration / E2E / Secret scan / Dep-vuln / Migration smoke / Runtime check / Screenshot diff), Run all button, expandable findings
- Visual QA mode: 12 cells (3 routes × 4 viewports), Capture all button, legend, detail panel
- Zero new console errors after page reload

---

### [Step 11] Approval matrix — COMPLETE ✅

**Deliverables completed**
- [x] `apps/api/src/security/approvalMatrix.ts` — `checkApproval()` decision engine (19 action types); `validateApproval()` server-side gate (checks DB row: tenant, project, action, status, expiry)
- [x] `apps/api/src/routes/approvals.ts` — full CRUD + review: `POST /api/approvals/check` (pure decision), `POST /api/approvals` (create bundle), `GET /api/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/approve|reject|changes`
- [x] `apps/api/src/routes/db.ts` — migration apply gate now calls real `validateApproval()` (not a TODO stub)
- [x] `apps/api/src/server.ts` — `approvalsRoutes` registered
- [x] `apps/web/src/layout/LeftPanel/ApprovalsQueue.tsx` — compact queue in left panel: pending approval cards with Approve/Reject buttons, recent decisions, badge count
- [x] `apps/web/src/layout/LeftPanel/LeftPanel.tsx` — ApprovalsQueue wired in (replaces stub placeholder)
- [x] `apps/web/src/screens/ApprovalsScreen.tsx` — full screen: 4 filter tabs, approval cards with expandable bundle (severity dot, scope, scale, verification results, diff summary), ReviewPanel with note textarea + 3 action buttons
- [x] `apps/web/src/app/Router.tsx` — `/approvals` route added + `ApprovalsScreen` imported
- [x] `apps/web/src/layout/TopBar/TopBar.tsx` — "Approvals" nav link added (active-highlighted)
- [x] `packages/ui/styles/screens.css` — `.abw-approvals-queue-*`, `.abw-approval-card-*`, `.abw-approval-bundle-*`, `.abw-approval-review` CSS classes

**Acceptance: PASSED ✅**
- 19/19 monorepo typecheck clean
- `/approvals` screen: title "Approvals", 4 filter tabs, empty state, Refresh button ✓
- LeftPanel: ApprovalsQueue rendered, badge logic present ✓
- Nav link "Approvals" active when on `/approvals` ✓
- Server-side bypass test: migration apply to staging/prod without `approvalId` → 403; with invalid `approvalId` → 403 (validateApproval rejects it)
- All approval decisions audited via `writeAuditEvent()`

---

### [Step 12] Project types, websites, onboarding automation — COMPLETE ✅

**Deliverables completed**
- [x] `packages/project-types/types.ts` — `ProjectType`, `FileTree`, `ScaffoldInput`, `VerificationAdapter`, `ApprovalPolicy`, `WorkspaceScreen` interfaces
- [x] `packages/project-types/blank/index.ts` — Blank type (README only; minimal matrix)
- [x] `packages/project-types/website/index.ts` — multi-page HTML site: Hero/Features/CTA sections, nav, per-page generators, styles.css, metadata.json (SEO/OG/schema.org), wrangler.toml (CF Pages publish)
- [x] `packages/project-types/landing-page/index.ts` — single-page conversion layout: Hero/Proof/Features/Pricing (3 tiers)/FAQ/CTA with email capture form
- [x] `packages/project-types/dashboard/index.ts` — React+Vite admin dashboard: sidebar nav, stat widgets, data table, dark theme
- [x] `packages/project-types/internal-tool/index.ts` — CRUD internal tool: top nav, records table, empty states, auth-conscious approval policy
- [x] `packages/project-types/onboarding-flow/index.ts` — multi-step wizard: typed `StepDef[]`, progress tracking, approval-required flag per step, rollback slot
- [x] `packages/project-types/automation-panel/index.ts` — automation control panel: trigger board, live/non-live distinction, `awaiting_approval` state, `AutomationHandler<I,O>` typed contract
- [x] `packages/project-types/saas-app/index.ts` — multi-tenant SaaS monorepo: web+api+shared packages, Fastify proxy, production approval policy
- [x] `packages/project-types/api-service/index.ts` — Fastify+Zod REST API: typed route plugin, health route, OpenAPI note, Vitest stub
- [x] `packages/project-types/full-stack-app/index.ts` — full React+Fastify+Drizzle monorepo: turbo pipeline, shared Zod contracts, DB schema starter
- [x] `packages/project-types/index.ts` — registry: `listProjectTypes()`, `getProjectType()`, `findProjectType()`, `scaffold()` API
- [x] `apps/web/src/screens/OnboardingAutomationScreen.tsx` — 4 tabs:
  - **Flows**: empty state → "Create first flow" → `NewFlowDialog` (template picker: Standard/Quick Start/Enterprise/Custom) → `FlowCard` grid → `FlowDetail` step list with per-step status badges
  - **Business Intake**: company/industry/website/email/goals form fields with save/clear
  - **Brand & Materials**: color pickers with hex sync, logo URL, voice tone + font style selects, live brand preview swatch
  - **Checklist**: 7-item progress tracker with gated items (approval-required items show lock icon, cannot be bypassed)
- [x] `apps/web/src/app/Router.tsx` — `/onboarding` route added + `OnboardingAutomationScreen` imported
- [x] `apps/web/src/layout/TopBar/TopBar.tsx` — "Onboarding" nav link added
- [x] `packages/ui/styles/screens.css` — `.abw-oa__*` classes (form layout, flow card/list/detail, step list/badges, checklist, brand preview, color pickers), `.abw-badge--warning`, `.abw-input--textarea`, `.abw-banner--info`, `.abw-banner--success`

**Acceptance: PASSED ✅**
- 19/19 monorepo typecheck clean
- `/onboarding` route renders: title "Onboarding Automation", 4 tabs, Flows empty state with "Create first flow" CTA
- "Onboarding" nav link present and active on `/onboarding`
- All approval-gated checklist items show lock icon and cannot be directly toggled
- Flow creation dialog: 4 templates, creates flow with 5 default steps (account-setup step is approval-flagged)
- Brand preview swatches update live on color change

---

### [Step 13] Operational surfaces — IN PROGRESS 🔄

**Completed deliverables**
- [x] `apps/api/src/realtime/channels.ts` — Supabase Realtime broadcast helpers: `broadcastRunEvent`, `broadcastToChannel`, channel name helpers
- [x] `apps/api/src/routes/runs.ts` — emit callback now calls `broadcastRunEvent()` so run events are pushed to browser in real time
- [x] `apps/web/src/layout/LeftPanel/ChatThread.tsx` — Realtime subscription: when `activeRun` becomes set, subscribes to `run:{runId}` channel via dynamic `@supabase/supabase-js` import; appends log events as streaming assistant messages; run-in-progress banner with pulse dot
- [x] `apps/web/src/screens/DatabaseSchemaScreen.tsx` — added `Browser` tab (3rd tab): sidebar table list, SQL editor textarea (Ctrl+Enter to run), results grid with column headers and NULL display, DB query calls `/api/db/query`
- [x] `apps/web/src/features/api-tester/ApiTester.tsx` — full API tester: method selector (color-coded), URL input, header key/value pairs with enable/disable/remove, body textarea for POST/PUT/PATCH, response panel with status/duration/size, body + headers tabs, Abort support
- [x] `apps/web/src/screens/LogsHealthScreen.tsx` — 4-tab screen:
  - **Logs**: level filter (all/debug/info/warn/error), clear button, live tail toggle (simulated 2.5s interval; real: Supabase Realtime), auto-scroll, 500-entry ring buffer
  - **Requests**: request trace table with method (monospace), path, status (color-coded), duration, timestamp
  - **Webhooks**: payload inspector with expand/collapse, header + body view, replay button (calls `/api/webhooks/replay`)
  - **Health**: service health grid — API, Supabase, Upstash, Cloudflare KV, MiniMax, Ollama; ok/error with latency + detail
- [x] `apps/web/src/app/Router.tsx` — `/logs` route added + `LogsHealthScreen` imported
- [x] `apps/web/src/layout/TopBar/TopBar.tsx` — "Logs" nav link added
- [x] `packages/ui/styles/screens.css` — `.abw-db-browser__*`, `.abw-api-tester__*`, `.abw-logs__*`, `.abw-chat__run-*`, `.abw-banner--error` CSS classes
- [x] `apps/web/package.json` — `@supabase/supabase-js ^2.44.0` added to dependencies

**Acceptance: PASSED ✅**
- 19/19 monorepo typecheck clean
- `/logs` screen: title "Logs & Health", 4 tabs, 5 stub log entries, "Logs" nav link
- `/database` Browser tab: Schema/Migrations/Browser tabs, sidebar with `users`/`orders`, SQL editor + Run button
- ChatThread: Realtime subscription wired (skips gracefully without `VITE_SUPABASE_URL`)

**Remaining items (stub with clear status)**
- **Integrated terminal** — xterm.js UI stub (wire in polish phase; `shell.exec.ts` tool exists)
- **Git panel** — commit history, clone, branch/snapshot recovery (wire in Step 14 polish)
- **Auth/session inspector** — reads from DB memberships/sessions (wire when auth is live)
- **Cron/scheduler** — visual cron editor tied to `jobs` table (wire in Step 14 polish)
- **Browser automation runner** — Playwright, approval-gated (wire in Step 14 polish)
- **Per-project DB** — `db.query` / `db.migrate` currently use platform DB; needs project-scoped conn string (Step 14)
- **API tester in workspace** — `ApiTester.tsx` component exists but not yet embedded in a workspace mode tab
- **Supabase Realtime for approval queue** — `broadcastToChannel` exists; `ApprovalsQueue` still polls

---

### [Steps 13 completion + Step 14] Polish & accessibility — COMPLETE ✅

**Workspace mode wiring**
- [x] `ApiTesterMode.tsx` created — reads `previewStore.session.previewUrl`, shows live/boot-pending status
- [x] `TerminalMode.tsx` created — textarea-based terminal, `POST /api/shell/exec`, ArrowUp/Down history, Ctrl+L clear
- [x] `Workspace.tsx` `MODE_MAP` updated — added `'api-tester'` and `'terminal'` entries
- [x] `SplitMode.tsx` `MODE_COMPONENTS` updated — same two modes added; split options include API + Terminal
- [x] `ModeTabs.tsx` — 9 tabs total: Preview | Code | Files | Console | Tests | Visual QA | API | Terminal | Split

**CSS token fixes**
- [x] `variables.css` — added missing aliases: `--surface-base`, `--surface-elevated`, `--border-default`, `--border-subtle`, `--text-tertiary`, `--color-accent` (all used throughout `screens.css`)
- [x] Dark mode overrides for all new aliases added

**Responsive breakpoints**
- [x] `app.css` — tablet breakpoint (≤1024px): left panel 260px, workspace tabs scroll, screen padding 16px
- [x] `app.css` — mobile breakpoint (≤768px): left panel collapses to 0, overlay when opened, search hidden
- [x] `abw-topbar__nav` + `abw-topbar__nav-link` styles moved to CSS (were inline/missing)
- [x] Print styles added (hides chrome, makes main content printable)

**Terminal CSS**
- [x] `.abw-terminal__*` classes added to `screens.css` — dark bg `#0d0f12`, green prompt, blink spinner, color-coded history lines, scrollbar styling
- [x] `.abw-mode__*` helper classes for API Tester mode header

**Accessibility fixes (lint errors → 0)**
- [x] `Resizable.tsx` — handle changed from `role="separator"` to `role="slider"` with `aria-valuenow/min/max`
- [x] `Select.tsx`, `Textarea.tsx`, `Input.tsx` — `React.useId()` always called unconditionally (extracted to `generatedId`)
- [x] `EditorTabs.tsx` — tab div now has `tabIndex={0}` and `onKeyDown` handler
- [x] `ModeTabs.tsx` — `<nav role="tablist">` → `<div role="tablist">` (nav is non-interactive)
- [x] `ApiTesterMode.tsx` — escaped `&apos;` in JSX text
- [x] `TestsMode.tsx`, `VisualQAMode.tsx` — escaped `&ldquo;`/`&rdquo;` in JSX text
- [x] `TerminalMode.tsx` — eslint-disable on output div click (intentional UX) and autoFocus
- [x] `OnboardingAutomationScreen.tsx` — eslint-disable on dialog autoFocus
- [x] `ProviderSettingsScreen.tsx` — unassociated `<label>` → `<p className="abw-field-label">` for non-input groupings
- [x] `security/patterns.ts`, `api/security/redact.ts` — removed unnecessary `\-` escapes in character classes

**Step 15 — Final verification**
- [x] `pnpm -w lint` — **12/12 tasks, 0 errors** (5 warnings, all acceptable)
- [x] `pnpm -w typecheck` — **19/19 tasks successful**
- [x] `pnpm --filter @abw/web build` — **✓ built in ~5s**, 215 modules, no errors
- [x] CSS: 65 kB (10 kB gzip), JS: 577 kB (164 kB gzip) — reasonable for this feature set

---

---

### [Step 16] Missing screens — COMPLETE ✅

**Deliverables completed**
- [x] `apps/web/src/screens/ProjectsScreen.tsx` — project grid with status dots, type icon, env badge; 2-step "New project" dialog (type picker → details form); search/filter
- [x] `apps/web/src/screens/PublishScreen.tsx` — Targets tab (Cloudflare Pages/static/Supabase targets with connect status, deploy button); Deployments tab (history table); production deploy shows approval banner; "Add target" dialog
- [x] `apps/web/src/screens/IntegrationsScreen.tsx` — Connected tab (OAuth cards with status, reconnect, disconnect); Available tab (category-grouped grid, search); "Connect" dialog with vault notice; approval callout for OAuth reconnections
- [x] `apps/web/src/screens/AgentRunsScreen.tsx` — run history table (status, goal, model, steps, duration, cost); status filter tabs; click-to-open step detail panel (role, tool, status, duration per step)
- [x] `apps/web/src/screens/VersionsScreen.tsx` — snapshot list with trigger type (manual/agent/save), label, file count, relative time; "Restore" (non-destructive, confirmation required); "Snapshot now" dialog; restored success banner
- [x] `apps/web/src/screens/AssetsScreen.tsx` — grid + list view toggle; type filter tabs; drag-and-drop upload zone; thumbnail previews for images; copy URL, delete (audited); Supabase Storage note
- [x] `apps/web/src/screens/TemplatesScreen.tsx` — full template grid by category; search; "Use template" opens scaffold dialog with live file tree preview and verification matrix list
- [x] `apps/web/src/app/Router.tsx` — 7 new routes: `/projects`, `/publish`, `/integrations`, `/runs`, `/versions`, `/assets`, `/templates`
- [x] `apps/web/src/layout/TopBar/TopBar.tsx` — 7 new nav links added
- [x] `packages/ui/styles/screens.css` — 200+ lines of new `.abw-*` CSS: `.abw-projects__grid`, `.abw-project-card`, `.abw-project-type-grid`, `.abw-project-type-card`, `.abw-integrations-grid`, `.abw-integration-card`, `.abw-runs__*`, `.abw-version-row`, `.abw-versions__list`, `.abw-assets__grid`, `.abw-asset-card`, `.abw-assets__drop-zone`, `.abw-template-grid`, `.abw-template-card`, `.abw-badge--info`
- [x] `apps/web/package.json` — `@abw/project-types: workspace:*` added
- [x] `apps/web/tsconfig.json` — `@abw/project-types` path alias added
- [x] `apps/web/vite.config.ts` — `@abw/project-types` Vite alias added

**Acceptance: PASSED ✅**
- 20/20 monorepo typecheck clean (all packages)
- `pnpm --filter @abw/web build` → 233 modules, built in 5.95s, zero errors
- CSS: 72 kB (11 kB gzip), JS: 691 kB (189 kB gzip) — expected growth from 7 new screens

---

## Where to resume

**All screens now exist.** The workspace is feature-complete at the UI + stub level.

Remaining backend wiring / future phases:
- **Supabase auth** — user sessions, RLS enforcement in browser; needs `supabase.auth.signIn` flow
- **Per-project DB connection** — `db.query`/`db.migrate` use platform DB; project-scoped Postgres connection strings go in vault
- **Git panel** — commit history, clone, branch recovery in CodeMode (placeholder exists)
- **Cron/scheduler visual editor** — tied to `jobs` table and Upstash QStash (backend TODO in JobsQueuesScreen)
- **Browser automation runner** — Playwright runner, approval-gated; UI stub in LogsHealthScreen
- **Supabase Realtime for ApprovalsQueue** — currently polls; `broadcastToChannel` is ready server-side
- **xterm.js upgrade** — TerminalMode uses textarea; real xterm.js is polish note
- **Real API wiring for new screens** — ProjectsScreen, PublishScreen, IntegrationsScreen, AgentRunsScreen, VersionsScreen, AssetsScreen need to call real API endpoints (all currently use local state stubs)
- **`/api/integrations` route** — CRUD for OAuth connection records; vault storage of refresh tokens

## Open questions for the human (none)
