# Dashboard type SOP — runtime rules for executor + polish

This SOP applies to projects of type `dashboard`. A FUNCTIONAL admin /
analytics dashboard — sidebar nav, KPI cards, data tables, and at least
one form for creating / editing the primary entity. Buttons click,
forms submit, state persists across navigation.

## Tech stack — vanilla, NOT React/Vite

**Use vanilla HTML pages + Tailwind via CDN + inline `<script>` blocks
+ `localStorage`.** Do NOT use React, Vite, react-router, recharts, or
any npm package. The preview pipeline does not install third-party node
modules; React builds degrade to non-interactive static HTML and every
onClick handler vanishes.

For charts: use inline SVG (`<rect>` bars, `<polyline>` line charts,
`<circle>` for sparklines) — no Chart.js / Recharts / D3 imports.

The Interactivity Mandate in the executor directive is the law — it
overrides any guidance below that suggests otherwise.

## File layout (flat — one .html per route, all at workspace root)

```
index.html               # overview / KPI dashboard
<entity>.html            # data table per resource (e.g. users.html, orders.html)
new-<entity>.html        # create-record form
settings.html
login.html               # mock auth gate, optional
```

No `src/`, no `apps/`, no `package.json`. The agent should NOT scaffold
a build pipeline.

## Required pattern on every page

Every page is a self-contained HTML document with:

1. `<head>` — Tailwind CDN, title, meta description
2. `<body>` — fixed sidebar + main content area
3. Inline `<script>` at end of `<body>` — `readState()` / `writeState()`
   helpers, `seedIfEmpty()` IIFE, event handlers, render-from-state on
   page load

## State management contract

Single localStorage key: `<slug>_state` holding a JSON-stringified
object. Shape per the planner's chosen entities, typically:

```js
{
  users:    [{ id, name, email, role, signupDate }, …],
  orders:   [{ id, customerId, amount, status, date }, …],
  settings: { theme: "light", currency: "USD" }
}
```

The seed-if-empty IIFE populates 8-20 realistic sample records per
entity so the dashboard charts and tables aren't empty on first load.

## Standard layout shell (every page)

```html
<div class="flex h-screen bg-slate-50">
  <!-- Sidebar -->
  <aside class="w-60 bg-slate-900 text-slate-100 p-4">
    <h1 class="text-lg font-bold mb-6">App Name</h1>
    <nav class="flex flex-col gap-1">
      <a href="index.html" class="px-3 py-2 rounded hover:bg-slate-800">Overview</a>
      <a href="users.html" class="px-3 py-2 rounded hover:bg-slate-800">Users</a>
      <a href="orders.html" class="px-3 py-2 rounded hover:bg-slate-800">Orders</a>
      <a href="settings.html" class="px-3 py-2 rounded hover:bg-slate-800">Settings</a>
    </nav>
  </aside>
  <!-- Main -->
  <main class="flex-1 overflow-y-auto p-8">
    <!-- page content here -->
  </main>
</div>
```

Active route can be styled via inline `<script>` after page load
matching `window.location.pathname` against the link `href`. Don't
hard-code "active" classes in the HTML.

## Per-page expectations

### Overview (index.html)

- **KPI strip across the top** — 3-5 stat cards computed from state
  (`totalUsers`, `mrr`, `activeOrders`, etc.). Each card shows label,
  value, optional delta vs previous period.
- **Primary chart** — inline SVG bar or line chart from a state series.
  Hard-coding the chart shape is OK; the data must come from state.
- **Recent activity** — last 5-10 records from the most relevant entity.
  Each row has a working "View" or "Mark complete" button.

### Data table (`<entity>.html`)

- Full table of all records from state
- Sortable columns: click header → mutate a local sort state → re-render
- Search input that filters rendered rows on every `input` event
- Per-row actions: delete (mutates state + re-renders), edit (opens
  modal or navigates to detail). Delete must work, not just look styled.
- "+ New" button → `new-<entity>.html`

### New-record form (new-<entity>.html)

- `<form onsubmit="…">` with required fields
- `event.preventDefault()` + validate non-empty required fields
- Push record to state via `writeState`
- Redirect to the list page or index

### Settings (settings.html)

- Renders current settings from state
- `onchange` handlers on every input that persist immediately

## Empty / loading / error states

- **Empty**: when an entity list is empty (after the seed), show a
  centered illustration + "No <entity> yet" + "+ New" CTA
- **Loading**: not relevant for localStorage demos — render synchronously
- **Error**: on form validation failure, render an inline `<p class="text-red-600">…` message

## Mock auth gate (optional)

If the planner includes `login.html`:
- Show a name + email form (no real password)
- On submit, set `state.user = { name, email, role: "admin" }`
- Redirect to index.html
- Other pages can check `if (!readState().user)` and redirect to login

This is a mock for shape — not real auth.

## Visual rules

- Voice + palette from the planner
- Light theme for traditional admin dashboards; dark theme works for
  developer-tools / monitoring dashboards
- Tailwind utility classes for everything — no inline `style=`
- Mobile responsive (sidebar collapses to top nav on `< md`)
- Numeric formatting via inline `Intl.NumberFormat` (locale-aware)

## Forbidden patterns

- Decorative buttons with no event handlers
- Hard-coded chart data when state should drive it
- Hard-coded table rows when they should map from state
- React / Vue / JSX / npm imports
- Calling out to external APIs (no fetch to Supabase, no auth endpoints)
- "Coming soon" placeholders on what should be a working feature

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`,
`delete_file`, `gen_image`
Phase B' (humanizer): not typically applicable (UI strings, not marketing copy)
Phase C (polish): inline regex audit
