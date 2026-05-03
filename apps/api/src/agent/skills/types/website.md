# Website type SOP — runtime rules for executor + polish

This SOP applies to projects of type `website` during the execute and polish
phases. The planner's SOP is separate (`planners/website.md`).

## File layout

```
index.html
<page>.html              # one per non-home page in the plan's sitemap
_shared/header.html      # nav chunk, included into every page
_shared/footer.html      # footer chunk, includes compliance blocks
styles.css               # optional shared CSS
images/<asset-id>.jpg    # one per shared_assets entry
```

No build step. No npm install. No frameworks. Pure HTML + CSS + Tailwind via
CDN script tag.

## Pages reference shared chunks via inline include

The executor writes a small inline `<script>` at the top of every page that
fetches `_shared/header.html` and `_shared/footer.html` and slots them in.
Don't write a full nav/footer into every page — write a `<div data-include="header">`
slot and let the script handle it.

## Tailwind CDN setup

Every page's `<head>` includes:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

That's it. No PostCSS, no config file unless the user explicitly asks.

## Color palette

Use the palette the planner picked from the niche manifest. Drive a small
`<style>` block in `<head>` from the palette's hex values:

```css
:root {
  --c-primary:  /* hexes[0] */;
  --c-surface:  /* hexes[1] */;
  --c-tint:     /* hexes[2] */;
  --c-ink:      /* hexes[3] */;
}
```

Use these CSS vars in your Tailwind via arbitrary values: `bg-[var(--c-primary)]`.

## Section library

Each niche manifest declares a `section_library` of supported section names.
When you render a page, walk its `sections` array (from the plan) and emit
the corresponding markup. Sections are reusable across pages — the same
`hero` section markup applies on `index.html` and a `page-hero` variant on
inner pages.

Common sections (apply to most niches):

- `hero` — large headline + subhead + primary CTA + optional image
- `page-hero` — slimmer header for inner pages
- `feature-strip` — 3-up icon + label + blurb columns
- `cta` / `appointment-cta` — single CTA block with button
- `footer` — wraps the shared footer chunk + compliance blocks

Niche-specific sections: see the `section_library` in the niche manifest.

## Security rules (hard, enforced)

The pre-write security scanner blocks/strips these from any HTML you generate:

- Hardcoded API keys (sk-, AKIA, pk_live_, ghp_, ya29., JWT-shaped)
- Inline `<script>` from non-allowlisted CDNs without SRI hashes
- `<iframe src="...">` from non-allowlisted domains
- Form fields that echo back to the page without escaping (XSS)

Auto-fixed by the polish phase:

- `target="_blank"` outbound links missing `rel="noopener noreferrer"`
- Missing `<img alt="">` (derived from filename + nearby copy)
- Missing focus-visible CSS for interactive elements
- Missing `<html lang="…">`

## SEO rules

- Every page: `<title>` ≤ 60 chars, `<meta name="description">` ≤ 160 chars (from `seo` slot in plan)
- One `<h1>` per page
- Heading hierarchy without skips (h1 → h2 → h3)
- Open Graph + Twitter Card meta tags on every page
- Schema.org JSON-LD per page based on `schema_org` from plan
- **Footer keyword density check:** the polish phase counts occurrences of
  primary niche keywords in `<footer>`. If any single keyword > 3% density,
  the polish phase rewrites the footer in natural prose. Don't keyword-stuff
  the footer — it's a search engine penalty and we'd rather the page rank.

## Accessibility rules

- All `<img>` need alt text
- Color contrast ≥ 4.5:1 for body text against background
- All `<form>` inputs have `<label for="...">`
- Focus-visible outline on interactive elements
- `<html lang="en">` on every page

## Tool surface

Phase B (executor) sees:

- `read_file` — for reading shared chunks + the plan
- `write_file` — for writing pages, copy.json, shared chunks
- `gen_image` — only when generating shared assets

Phase B' (humanizer) sees only `humanize_doc`.

Phase C (polish) sees `read_file`, `write_file`, `list_files`.
