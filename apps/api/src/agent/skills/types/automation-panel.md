# Automation-panel type SOP — runtime rules for executor + polish

This SOP applies to projects of type `automation-panel`. A UI for
triggering, queuing, and observing background jobs / workflows. Demo /
mock implementation: clicking "Run" pushes a job into a localStorage
queue, the queue auto-advances on a timer, status updates in place.

## Tech stack — vanilla, NOT React/Vite

**Use vanilla HTML pages + Tailwind via CDN + inline `<script>` +
`localStorage`.** Do NOT use React, Vue, Vite, npm dependencies, or
real background workers. The preview pipeline does not install third-
party node modules; React builds degrade to non-interactive static
HTML and every onClick handler vanishes.

The Interactivity Mandate in the executor directive is the law.

## File layout

```
index.html               # active jobs queue + trigger button
history.html             # completed jobs log
new-job.html             # configure + trigger a new job
settings.html            # webhook URLs, schedules, etc.
```

Flat HTML files at workspace root. No `src/`, no `apps/`, no
`package.json`.

## State management

Single localStorage key: `<slug>_state` holding:

```js
{
  jobs:    [
    { id, name, type, status: "queued"|"running"|"succeeded"|"failed",
      createdAt, startedAt: null|iso, completedAt: null|iso,
      params: {…}, result: null|string }
  ],
  schedules: [
    { id, cronExpr: "0 */4 * * *", jobType, lastRun, nextRun }
  ],
  webhooks: [
    { id, url, eventType, secret, lastFired }
  ]
}
```

The seed-if-empty IIFE populates 5-15 sample jobs covering all four
statuses so the dashboard / history pages render rich content on
first load.

## Required interactivity per page

### Active queue (index.html)

- Renders ALL jobs from state with status badges
- "Run job" button on each queued job → flips status to "running",
  then a `setTimeout(2000-5000ms)` flips to "succeeded" with mock result
  text. UI must re-render at each transition.
- "Cancel" button on running jobs → flip to "failed" with result "Cancelled by user"
- "Retry" button on failed jobs → flip to "queued" with cleared timestamps
- "+ Trigger new job" button → `new-job.html`
- KPI strip at top: `<N> queued, <M> running, <K> succeeded today`
  computed from state on render

### Trigger form (new-job.html)

- `<form onsubmit="…">` with job-type select + per-type param fields
- `event.preventDefault()` + validate
- Push a new job (id = `Date.now().toString(36)`, status = "queued") to state
- Redirect to index

### History (history.html)

- Filterable table of completed jobs (succeeded + failed + cancelled)
- Search + status filter, click row to expand result text
- "Clear history" button (with confirm) wipes the completed entries

### Settings (settings.html)

- Webhook URL management: add/remove
- Schedule management: add cron-style schedules
- All inputs persist on `change` / `submit`

## Visual rules

- Dense, ops-flavored — closer to internal-tool than to landing-page
- Status badges colored: queued=slate, running=amber pulse, succeeded=green, failed=rose
- Voice + palette per planner
- Tailwind utility classes; no inline `style=`

## Forbidden patterns

- "Trigger" buttons that don't actually create a job entry
- Status badges that never transition
- Real webhook POSTs (no `fetch` to external URLs — this is a static demo)
- React / Vue / JSX / npm imports
- Hard-coded job lists when state should drive them

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`,
`delete_file`, `gen_image`
Phase B' (humanizer): not typically applicable
Phase C (polish): inline regex audit
