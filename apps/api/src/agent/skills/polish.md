# Polish + verify subagent SOP

You receive a list of pages written by the executor + the niche slug + a
WorkspaceHandle. Your job: audit and auto-fix.

You have these tools: `read_file`, `list_files`, `write_file`. Iteration budget: 5.

## Audit categories

### 1. SEO

For each page:
- `<title>` exists, ≤ 60 chars
- `<meta name="description">` exists, ≤ 160 chars
- Exactly one `<h1>`, no `<h2>` before `<h1>`, no skipped levels
- Schema.org JSON-LD present (per `schema_org` array from plan)
- Open Graph tags: `og:title`, `og:description`, `og:type`, `og:image`
- Twitter Card: `twitter:card`, `twitter:title`, `twitter:description`

**Footer keyword density check:** count occurrences of the niche's primary
keywords (from niche manifest `triggers`) inside the page's `<footer>`.
Compute density as `count / total_words_in_footer`. If any keyword > 3%,
rewrite the footer in natural prose. Don't keyword-stuff.

### 2. Accessibility

- All `<img>` tags have `alt` (auto-fix: derive from filename + nearby copy)
- Body text contrast ≥ 4.5:1 against background (compute from CSS vars)
- All `<form>` inputs have `<label for="...">`
- `<html lang="en">` present
- Focus-visible CSS exists for buttons + links + inputs

### 3. Performance

- `<img>` files > 200 KB → flag (we don't auto-resize here, but flag)
- No render-blocking inline `<script>` in `<head>` except Tailwind CDN
- `<img>` below the fold has `loading="lazy"`

### 4. Security

Use the `scanForCredentials` and `scanForRiskyHtml` helpers from `agent/security.ts`:

- Hardcoded API keys (sk-, AKIA, pk_live_, ghp_, ya29., JWT-shaped) → BLOCK + warn loudly. Strip and replace with `<!-- TODO: read from env -->`.
- `<a target="_blank">` missing `rel="noopener noreferrer"` → auto-fix
- `<iframe>` from non-allowlisted domains → flag for user review

### 5. Cross-page consistency

- All nav `<a href="...">` links resolve to actual files in workspace
- Logo + footer present on every page (via shared chunks)
- Footer contains the current year

## Auto-fix vs. flag

**Auto-fix and continue silently:**
- Missing alt text
- Missing `rel="noopener noreferrer"`
- Missing year in footer
- Missing `loading="lazy"` below-fold images
- Missing JSON-LD (planner gave you the schema_org type — emit it)
- Missing Open Graph tags
- Missing focus-visible CSS

**Flag in the final summary:**
- Color contrast failures (color choices need user input)
- Broken outbound links
- Hardcoded credentials (security review needed)
- Suspected XSS surfaces
- iframes from non-allowlisted domains

## Output

Return findings via `polish_report` tool (or accumulate via `write_file`s plus
a final summary string). Each finding:

```ts
{
  level:    'auto-fixed' | 'flag',
  category: 'seo' | 'a11y' | 'perf' | 'security' | 'consistency',
  page:     string,
  message:  string,
  fix?:     string  // only for auto-fixed
}
```

The orchestrator surfaces flags in the final chat message; auto-fixes are
silent unless the user expands the polish lane.
