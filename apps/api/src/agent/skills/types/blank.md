# Blank type SOP — runtime rules for executor + polish

This SOP applies to projects of type `blank`. Used when the user's brief
doesn't fit a specialized type. Goal: get them to a working scaffold fast,
with minimum assumptions.

## Decision flow

```
brief arrives
  │
  ├─ unambiguous brief? ───► infer the closest specialized type
  │                            (landing-page, dashboard, document, ...)
  │                            and switch to that SOP
  │
  └─ ambiguous brief?    ───► raise ONE clarifying question via human_flags,
                              then proceed with whatever the user picks
```

Don't over-clarify. If you can ship something useful with one assumption,
ship it and document the assumption in the README. The user can iterate.

## When to ask vs assume

**Assume and proceed if:**

- The deliverable shape is obvious (a "marketing page" → landing-page)
- The user supplies a body of content and just needs presentation
- The brief names a niche the manifests cover

**Ask one question via `human_flags` if:**

- Two specialized types are equally plausible (e.g. "build me a tool to manage
  customers" — internal-tool? saas-app? dashboard?)
- A core decision blocks the file layout (with auth? without? web only? +API?)
- The brief is one ambiguous sentence with no verbs

The clarifying question should offer 2–4 concrete options, not be open-ended.

## Default minimum scaffold

If you must ship without further info, produce:

```
index.html              # single page, Tailwind via CDN
README.md               # one paragraph: what was built, what assumptions were made
styles.css              # optional
```

Contents of `index.html`:

- Hero with the brief restated as a value prop
- A single section explaining what would come next
- A "next steps" list of 3–5 concrete options the user can pick from

This is intentionally minimal. The point is to get a render, get feedback,
and route to a specialized SOP on the next iteration.

## human_flags template

When asking, structure the flag as:

```json
{
  "kind": "clarification",
  "question": "Quick question before I build — which of these matches what you want?",
  "options": [
    { "id": "landing-page", "label": "Public marketing page" },
    { "id": "dashboard",    "label": "Logged-in product UI" },
    { "id": "internal-tool","label": "Internal admin/CRUD tool" },
    { "id": "other",        "label": "None of these — let me describe more" }
  ]
}
```

One question, concrete options, "other" escape hatch.

## Routing

Once the user (or the inference) picks a type, hand off the project to the
matching SOP:

| Pick                | SOP                  |
|---------------------|----------------------|
| public marketing    | landing-page.md      |
| multi-page site     | website.md           |
| product UI          | dashboard.md         |
| product + auth + DB | saas-app.md          |
| admin / CRUD        | internal-tool.md     |
| signup wizard       | onboarding-flow.md   |
| job runner / cron   | automation-panel.md  |
| API only            | api-service.md       |
| FE+BE generic       | full-stack-app.md    |
| static doc / PDF    | document.md          |
| HTML email          | email-composer.md    |
| KDP manuscript      | ebook.md             |
| beat / score        | music-studio.md      |
| long video          | ai-movie.md          |
| ad spot             | ai-commercial.md     |
| vertical short      | ai-short.md          |
| music sync video    | ai-music-video.md    |

## Security rules (hard, enforced)

Until a specialized SOP is selected, treat outputs as if the strictest of:

- No `<script>` from unknown CDNs
- No hardcoded credentials anywhere
- No external `<iframe>` from non-allowlisted domains
- No collection of PII without an obvious form purpose

These are floor rules. The chosen specialized SOP may add more.

## Quality rules

- README always lists the assumptions made and how to override them
- The fallback scaffold is not a placeholder dump — it's a coherent page
  that demonstrates a path forward
- Never output a single empty `index.html`

## Tool surface

Phase B (executor): `read_file`, `write_file`, `human_flags`
Phase B' (humanizer): `humanize_doc` for README + body copy
Phase C (polish): `read_file`, `write_file`, `list_files`
