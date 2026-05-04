# Landing page type SOP — runtime rules for executor + polish

This SOP applies to projects of type `landing-page`. Single-page, conversion-focused
site with a clear primary action above the fold.

## File layout

```
index.html              # the entire experience, single page
styles.css              # optional, only if Tailwind utilities aren't enough
images/<asset-id>.jpg   # hero / feature / testimonial photos
favicon.ico
```

No build step. No frameworks. Pure HTML + Tailwind via CDN.

## Tailwind CDN setup

The single page's `<head>` includes:

```html
<script src="https://cdn.tailwindcss.com"></script>
<link rel="icon" href="/favicon.ico" />
```

## Section library

Walk the plan's `sections` array (in order) and emit each block. The standard
library for landing pages is:

- `hero` — bold headline + value prop + primary CTA + supporting visual. Above-the-fold.
- `social-proof` — logo strip OR star rating + count ("Trusted by 4,200+ teams")
- `features` — 3- or 6-up grid: icon + label + 1-line benefit
- `how-it-works` — 3 numbered steps with short copy
- `testimonials` — 1–3 quotes with name, title, photo
- `pricing` — 1–3 tiers with feature list and clear CTA per tier
- `faq` — `<details>` accordion of 5–8 questions
- `cta` — closing conversion block, repeats primary CTA

The primary CTA must be visible without scrolling on a 1366×768 viewport.

## Copy / voice rules

- Hero headline ≤ 10 words, benefit-driven (not feature-driven)
- Subhead ≤ 25 words, names the audience and the outcome
- CTA button copy is a verb phrase ("Start free trial", not "Submit")
- One <h1> per page (the hero headline). Everything else is h2/h3.
- Social proof uses real-feeling specifics ("4,217 teams", not "thousands")

## Example hero block

```html
<section class="bg-[var(--c-surface)] py-20 px-6">
  <div class="max-w-5xl mx-auto text-center">
    <h1 class="text-5xl font-bold text-[var(--c-ink)] mb-4">
      Ship landing pages in minutes, not weeks
    </h1>
    <p class="text-lg text-[var(--c-ink)]/80 mb-8 max-w-2xl mx-auto">
      AI-built, conversion-tested templates wired to your stack.
    </p>
    <a href="#pricing"
       class="inline-block bg-[var(--c-primary)] text-white px-8 py-4 rounded-lg font-semibold">
      Start free trial
    </a>
  </div>
</section>
```

## Security rules (hard, enforced)

The pre-write security scanner blocks/strips:

- Hardcoded API keys (sk-, AKIA, pk_live_, ghp_, ya29., JWT-shaped)
- Inline `<script>` from non-allowlisted CDNs without SRI hashes
- `<iframe>` from non-allowlisted domains (allow: youtube, vimeo, calendly, stripe)
- Unescaped form fields that round-trip user input
- Form `action=` pointing to non-HTTPS endpoints

Auto-fixed by polish:

- `target="_blank"` outbound links missing `rel="noopener noreferrer"`
- Missing `<img alt="">`
- Missing `<html lang="en">`

## SEO rules

- `<title>` ≤ 60 chars, `<meta name="description">` ≤ 160 chars
- Exactly one `<h1>` (the hero headline)
- Heading hierarchy without skips
- Open Graph + Twitter Card meta on every page
- Schema.org `WebPage` + `Organization` JSON-LD
- Canonical URL set
- Hero image has `loading="eager"`; everything else `loading="lazy"`

## Conversion / quality rules

- Primary CTA repeated at least 3 times down the page (hero, mid, bottom)
- Forms ask for the minimum (email-only when possible)
- No carousel for hero — flat content converts better
- Pricing has anchor pricing (3 tiers; middle tier "most popular")
- FAQ uses native `<details>` (no JS required)

## Accessibility rules

- All images have alt text
- Body contrast ≥ 4.5:1
- Form inputs labeled
- Focus-visible outlines on interactive elements
- `<html lang="en">` set

## Tool surface

Phase B (executor): `read_file`, `write_file`, `gen_image`
Phase B' (humanizer): `humanize_doc`
Phase C (polish): `read_file`, `write_file`, `list_files`
