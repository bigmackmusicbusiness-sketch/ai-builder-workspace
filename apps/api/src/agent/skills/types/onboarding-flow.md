# Onboarding-flow type SOP — runtime rules for executor + polish

This SOP applies to projects of type `onboarding-flow`. A multi-step
wizard that captures the user through a sequence of typed steps with a
visible progress indicator and save-and-resume support.

## Tech stack — vanilla, NOT React/Vite

**Use vanilla HTML pages + Tailwind via CDN + inline `<script>` +
`localStorage`.** Do NOT use React, Vue, Vite, framework routers, or
npm dependencies. The preview pipeline does not install third-party
node modules; React builds degrade to non-interactive static HTML and
every onClick handler vanishes.

The Interactivity Mandate in the executor directive is the law.

## File layout (one page per step + a complete + an entry)

```
index.html               # entry / step-1 OR a "welcome / start" page
step-2.html              # next step
step-3.html              # etc.
…
complete.html            # success / summary page
```

If the planner names steps (e.g. "profile", "preferences", "billing"),
use those slugs: `profile.html`, `preferences.html`, `billing.html`,
`complete.html`. Stick to the planner sitemap.

No `src/`, no `apps/`, no `package.json`.

## State management — single localStorage key tracks the whole flow

```js
{
  currentStep: "profile" | "preferences" | "billing" | "complete",
  steps: {
    profile:     { name, email, role, completedAt: null | iso },
    preferences: { theme, notifications, completedAt: null | iso },
    billing:     { plan, billingEmail,  completedAt: null | iso }
  },
  startedAt: iso
}
```

Each step page writes to its own `state.steps[<step>]` slice on submit
and sets `completedAt` so the progress bar shows the right state.

## Required interactivity per step page

- **Progress bar at top** — visual indicator showing N steps total,
  completed steps filled, current step highlighted. Renders from
  `state.steps` on every page load.
- **Header**: step title + 1-line description
- **Form body**: `<form onsubmit="…">` with the fields for this step
- **Buttons**: "Back" (link to previous step OR `history.back()`) + 
  "Continue" (form submit). Continue must:
   1. `event.preventDefault()`
   2. Validate non-empty required fields (inline error message on fail)
   3. Persist this step's data to state via writeState
   4. Mark `completedAt = new Date().toISOString()`
   5. Navigate to the next step

## Complete page

- Renders summary of all collected data from `state.steps`
- "Edit profile" / "Edit preferences" / "Edit billing" buttons each
  navigate back to that step page (which re-renders with prefilled inputs)
- "Restart" button clears state and goes to step 1
- "Done" button could link to a placeholder external destination
  (`https://example.com`) or a no-op alert

## Save and resume

On every page load:
- If `state.currentStep` is set AND user is on a different step page,
  show an inline banner: "Resuming from <step-name>" with a link
- Empty state (first ever load): start at step 1, set `state.startedAt`

## Visual rules

- Centered card on a soft-background page
- Generous whitespace (this is a guided flow, not dense ops)
- Voice + palette per planner
- Mobile-friendly — single-column layout, large tap targets
- Tailwind utility classes; no inline `style=`

## Forbidden patterns

- Steps without working Back/Continue buttons
- "Continue" that doesn't validate or persist
- Hard-coded progress bar (must render from state)
- React / Vue / JSX / npm imports
- Real submission to an external API

## Tool surface

Phase B (executor): `read_file`, `write_file`, `list_files`,
`delete_file`, `gen_image`
Phase B' (humanizer): may apply to welcome copy on the entry page
Phase C (polish): inline regex audit
