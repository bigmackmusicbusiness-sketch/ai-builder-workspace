# SaaS app type SOP — runtime rules for executor + polish

This SOP applies to projects of type `saas-app`. A FUNCTIONAL multi-page
web app — dashboard, list/manage screens, create-record form, settings.
Buttons click, forms submit, state persists across navigation, navigating
between pages re-renders from the same persisted state.

## Tech stack — vanilla, NOT React/Vite

**Use vanilla HTML pages + Tailwind via CDN + inline `<script>` blocks
+ `localStorage`.** Do NOT use React, Vue, Vite, npm packages, JSX, or
framework routers. The preview pipeline does not install third-party
node modules; a React build degrades to non-interactive static HTML and
every onClick handler vanishes.

This pattern is what produces a working webapp on first generate. The
Interactivity Mandate in the executor directive is the law — it
overrides any guidance below that suggests otherwise.

## File layout (flat — one .html per route, all at workspace root)

```
index.html               # dashboard / overview (default entry)
<entity>.html            # list view (e.g. tasks.html, users.html, projects.html)
new-<entity>.html        # create-record form
<entity>-detail.html     # optional single-record view if planner asks
settings.html
```

Plus optional shared assets:
```
images/<asset-id>.jpg    # generated via gen_image
```

No `src/`, no `apps/web/`, no `apps/api/`, no `package.json`, no
`vite.config.ts`. The agent should NOT scaffold a monorepo.

## Required pattern on every page

Every page is a complete self-contained HTML document with:

1. `<head>` containing:
   - Tailwind CDN: `<script src="https://cdn.tailwindcss.com"></script>`
   - Title + meta description
   - Optional: Schema.org JSON-LD if planner requested
2. `<body>` containing the page UI
3. Inline `<script>` at the end of `<body>` with:
   - `readState()` / `writeState()` helpers reading from
     `localStorage['<slug>_state']` (the slug is in the project context)
   - `seedIfEmpty()` IIFE that populates example data on first ever
     page load so the UI is never blank
   - Event handlers for every interactive element on this page

## State management contract

A single localStorage key holds a JSON-serialized object for the whole
app. Shape is up to the planner / niche, but typically:

```js
{
  tasks:    [{ id, title, status, priority, dueDate, createdAt }, …],
  settings: { theme: "dark", notifications: true },
  user:     { name: "Demo User", email: "user@example.com" }
}
```

Read on every page load. Mutate via writeState() on every interaction.
NEVER hard-code lists in HTML when they should be reading from state.

## Per-page interactivity expectations

### Dashboard (index.html)

- Reads state, renders KPI counts (e.g. "12 tasks total, 4 in-progress, 1 high-priority")
- Lists 5-10 recent items as cards or rows
- Each row has a working "Complete" or status-toggle button that mutates
  state and re-renders the list in place
- Top-right "+ New <entity>" button links to `new-<entity>.html`

### List page (<entity>.html)

- Renders ALL items from state as a table or grid
- Working filter / search input that filters the rendered list (re-render on `input` event)
- Per-row delete + edit (delete mutates state and re-renders; edit can navigate to detail or open a modal — modal is fine without a library, use a hidden `<div>` toggled by `classList.add('hidden')`)
- "+ New" button → `new-<entity>.html`

### New-record form (new-<entity>.html)

- `<form onsubmit="…">` with required fields per the entity schema
- `event.preventDefault()` in the handler
- Validate required fields (non-empty)
- Push new record to the state array via `writeState`
- Redirect to dashboard or list: `window.location.href = "index.html"`

### Settings (settings.html)

- Renders current settings from state
- Inputs (theme select, notification checkbox, profile name, etc.) with
  `onchange` handlers that immediately persist to state
- Optional "Save" button if grouped saves are more natural — must still
  persist on click

## Auth — do NOT implement real auth

A localStorage-backed SaaS demo cannot have real authentication. Skip
Supabase, OAuth, password forms entirely. If the planner sitemap
includes `login.html` or `signup.html`, those pages can be a polished
mock that "signs in" by setting `state.user = { name: input.value }` and
redirecting to index.html. Don't display a real password input on a
client-side demo.

## Visual / voice rules

- Voice + palette from the planner — use those exactly
- Dark themes work well for productivity apps; light themes for
  consumer-facing
- Use Tailwind utility classes for everything; no inline `style=` attrs
- Mobile responsive — Tailwind's `sm:`/`md:` prefixes
- Loading / empty / error states for every dynamic surface

## Forbidden patterns

- Buttons with no onclick / type="submit"
- Forms that submit without persisting
- Hard-coded lists when state should drive them
- `<a>` tags styled as buttons but linking to nowhere
- "Coming soon" placeholders on what should be a working feature
- React / Vue / JSX / npm imports
- `<select>` or `<input type="checkbox">` with no change handler
- Calling out to external APIs (no fetch to Stripe, Auth0, etc.) — this
  is a static demo, network calls fail in the preview

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`,
`delete_file`, `gen_image`
Phase B' (humanizer): `humanize_doc` for marketing-style copy
Phase C (polish): inline regex audit (no extra tool calls)
