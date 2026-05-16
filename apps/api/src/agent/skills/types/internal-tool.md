# Internal-tool type SOP — runtime rules for executor + polish

This SOP applies to projects of type `internal-tool`. An ops / admin
panel for an internal team — table-view of a primary entity, detail
panel, edit/create form, mock auth. Functionality first: buttons click,
forms submit, state persists.

## Tech stack — vanilla, NOT React/Vite

**Use vanilla HTML pages + Tailwind via CDN + inline `<script>` +
`localStorage`.** Do NOT use React, Vue, Vite, react-router, or any
npm dependency. The preview pipeline does not install third-party
node modules; React builds degrade to non-interactive static HTML and
every onClick handler vanishes.

The Interactivity Mandate in the executor directive is the law — it
overrides anything below that suggests otherwise.

## File layout

```
index.html               # table view of the primary entity (records list)
new-<entity>.html        # create form
<entity>-detail.html     # optional detail/edit view if planner asks
settings.html
login.html               # mock auth, optional
```

Flat HTML files at workspace root. No `src/`, no `apps/`, no
`package.json`.

## State management

Single localStorage key: `<slug>_state` holding a JSON-stringified
object keyed by entity name. The seed-if-empty IIFE populates 10-30
realistic records on first load so the table isn't empty.

```js
{
  records: [
    { id, name, status, owner, createdAt, lastEditedAt, … },
    …
  ],
  user: { name: "Demo Admin", role: "admin" }
}
```

## Required per-page interactivity

### Table view (index.html)

- All records rendered from state
- Sticky header with sortable columns (click header to sort)
- Search input filters rows live (`input` event)
- Optional facet filters (status dropdown, owner select) with `change` handlers
- Bulk-select checkboxes → top toolbar shows bulk-delete / bulk-status-change
- Per-row actions: delete (mutates state + re-renders), open (navigate
  to detail or open modal)
- "+ New" button → `new-<entity>.html`

### Create form (new-<entity>.html)

- `<form onsubmit="…">` with required fields per the entity
- `event.preventDefault()` + validate
- Push to state via `writeState`
- Redirect to index

### Detail / edit view (<entity>-detail.html)

- Reads `id` from query string: `new URLSearchParams(location.search).get('id')`
- Renders the record's fields as inputs (read-only for derived fields,
  editable for the rest)
- "Save" button persists to state
- "Delete" button confirms then removes from state + redirects to index

### Settings

- Profile, preferences. `onchange` persists immediately.

## Mock auth

If planner includes `login.html`, accept any name+email, persist to
`state.user`, redirect to index. Other pages can check
`if (!readState().user)` and redirect. NOT real auth.

## Visual rules

- Compact, dense — internal tools optimize for information density
- Tailwind utility classes; no inline `style=`
- Voice + palette per planner
- Mobile responsive but desktop-first (this is an ops tool)

## Forbidden patterns

- Decorative buttons / inputs with no handlers
- Hard-coded table rows (state must drive the render)
- React / Vue / JSX / npm imports
- Real API calls to internal services (this is a static demo)
- "Coming soon" placeholders on what should be a working feature

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`,
`delete_file`, `gen_image`
Phase B' (humanizer): not typically applicable
Phase C (polish): inline regex audit
