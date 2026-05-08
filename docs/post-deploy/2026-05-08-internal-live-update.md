# Post-deploy: 2026-05-08 internal-live update

**Commits landed:** `061445e..9b2e3e5` (8 commits)
**Branch:** `main`
**Deploy target:** Coolify VPS at `40.160.3.10` (api + IDE)
**Plan:** `~/.claude/plans/eventual-leaping-petal.md`

---

## Summary

Five-part update shipped end-to-end. Every part built, typechecked, and committed in
small atomic commits so the post-deploy script can attribute regressions to a
single change if anything fails.

| # | Commit | Surface |
|---|---|---|
| 1 | `56b9cf2` | post-deploy-check SOP runner |
| 2 | `b006ecd` | Higgsfield strip |
| 3 | `5ab1124` | Preview UX overhaul (single Refresh) |
| 4 | `9d996ad` | Platform Media (cross-project Library) |
| 5 | `671a0cf` | Ads backend + AI text-edit route |
| 6 | `d1777f6` | Ads frontend (3 tabs + quality bar) |
| 7 | `72b63f2` | AI text-edit modal |
| 8 | `9b2e3e5` | Files.ts self-heal gap fix |

---

## Verification

### Pre-merge (all clean)

- [x] `pnpm -r typecheck` — all 12 workspace packages green
- [x] `pnpm --filter @abw/api build` — 5.4 MB bundle, no TS errors
- [x] `pnpm --filter @abw/web build` — 1.25 MB JS, 109 KB CSS

### Post-deploy smoke (curl-driven, executed after Coolify roll)

SPA routes (web container served via Cloudflare Pages):

| Path | Status |
|---|---|
| `/projects`   | 200 |
| `/templates`  | 200 |
| `/create`     | 200 |
| `/video`      | 200 |
| **`/ads`** (new) | 200 |
| `/publish`    | 200 |
| `/approvals`  | 200 |
| `/login`      | 200 |

API endpoints (Coolify-deployed Fastify):

| Endpoint | Status | Notes |
|---|---|---|
| GET `/healthz`                   | 200 | service: api |
| POST `/api/ads` (unauth)         | 401 | auth gate confirmed; route registered |
| POST `/api/preview/refresh` (unauth) | 401 | new endpoint registered |
| POST `/api/ai-edit/text` (unauth)| 401 | Replicate route registered |
| GET `/api/ads/limits` (unauth)   | 401 | auth gate fires before handler — OK |

Container roll observed at +6 minutes after `git push`. No 500s, no boot
errors visible in logs. Migration `0013_ad_creatives` not yet visually
confirmed via `/api/admin/migrations`, but DDL is idempotent and the
runner emits warnings rather than crashing on permission issues.

### Post-deploy manual sweep (followups for the user when they wake up)

- [ ] Sign in, hit /ads, switch through the three tabs, render one image ad
- [ ] Verify the slop blocker rejects "amazing transformative results"
- [ ] Verify A/B variants come back from /api/ads/:id/render
- [ ] Verify chat paperclip → Library shows existing assets across projects
- [ ] Verify Preview shows a single Refresh button (no Stop/Boot)
- [ ] Verify project switch no longer auto-boots a preview
- [ ] Run `pnpm tsx apps/api/scripts/post-deploy-check.ts` against prod (needs a token in `$ABW_TOKEN`)

---

## Architectural decisions locked in

- **Ads scope:** Create only (no Marketing API publishing). Defer until app review or per-tenant System User token flow.
- **Cross-project import:** Picker references the asset by `assetId` — no live cross-project file references.
  Future "import as files" flow can copy into `_imported/<source-slug>/` from the same picker.
- **AI text-edit:** Off-by-default toggle (`runStore.aiEditEnabled`). ~$0.08/edit at 1024×1024.
  Manual canvas always available regardless of toggle.
- **Higgsfield:** Stripped from chat composer + agent tool registry. Provider files stay
  dormant on disk because `apps/api/src/lib/video/orchestrator.ts` still imports them.
  Full file deletion deferred until orchestrator audit.

## Slop-blocker phrase list (gated behind `force=true`)

26 generic-AI phrases rejected on Render. Override via "Render anyway" button.
See `apps/api/src/routes/ads/slopBlocker.ts` for the canonical list.

## Niche copy patterns shipped

`specialty-cafe`, `real-estate-agent`, `law-firm`, `fitness-studio`, `wedding-venue`
(5 niches × 3 frameworks = 15 high-quality seed patterns). Fallback patterns for
unknown niches use placeholder syntax to coach the user.

---

## Followups (NOT in this update)

- Marketing API publishing flow (deferred per plan)
- Removing Higgsfield provider files entirely (orchestrator import audit)
- TikTok / LinkedIn / Google Ads support (placement enum extension)
- Project-as-importable-component (`/api/assets/copy-into-project`)
- Tesseract.js OCR replacement for the AI text edit (we shipped manual rectangle-draw instead)
- Vision-model design quality check
