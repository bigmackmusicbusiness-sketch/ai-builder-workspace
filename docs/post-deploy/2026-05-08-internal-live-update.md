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

- [x] Pre-merge: `pnpm -r typecheck` clean across all 12 workspace packages
- [x] Pre-merge: `pnpm --filter @abw/api build` clean (5.4 MB bundle)
- [x] Pre-merge: `pnpm --filter @abw/web build` clean (1.25 MB JS, 109 KB CSS)
- [ ] Post-deploy: `pnpm tsx apps/api/scripts/post-deploy-check.ts` (run manually after Coolify deploy lands)
- [ ] Post-deploy: visual sweep of /projects, /ads, /video, /publish, builder mode
- [ ] Post-deploy: 1 ad creative end-to-end (image, render, A/B variants)
- [ ] Post-deploy: paperclip → Library → drop into chat
- [ ] Post-deploy: preview Refresh button replaces Stop/Boot

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
