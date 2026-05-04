# Document type SOP — runtime rules for executor + polish

This SOP applies to projects of type `document`. Static, print/PDF-ready HTML
documents: proposals, case studies, invoices, pitch decks, whitepapers.

## File layout

```
index.html              # the document, single file
print.css               # @page rules + print-only styles
images/<asset>.jpg
fonts/                  # local woff2 if not using Google Fonts
data.json               # optional: line items / metrics / quote params
```

No build step. No frameworks. No client-side JS — print/export must work
without script execution.

## Document kind switch

The plan declares `document.kind`. Each kind has its own section library:

### Proposal

- Cover page: client name, project name, date, your logo
- Executive summary (≤ 200 words)
- Scope of work — bulleted
- Deliverables — table
- Timeline — Gantt-style horizontal bars or milestone list
- Pricing — table with subtotal, tax, total
- Terms — numbered legal-style paragraphs
- Acceptance — signature block

### Case study

- Hero with client logo + headline result ("Increased X by Y%")
- Background — who they are, what they faced
- Approach — what we did, in plain language
- Results — 3 numbers in big type with brief context
- Quote — pull-quote from the client with name + title
- Next steps CTA

### Invoice

- Header: "INVOICE" + invoice number + issue date + due date
- Bill-from / Bill-to blocks
- Line items table (description, qty, rate, amount)
- Subtotal, tax (line per rate), total in bold
- Payment instructions + terms (Net 30, etc.)

### Pitch deck

- One section per slide, each `<section class="slide">` sized 16:9
- Title slide, problem, solution, market, traction, team, ask
- Print CSS forces `page-break-after: always` on each slide

### Whitepaper

- Title page + author + date + abstract
- Table of contents (auto-generated from h2/h3)
- Numbered sections + figures
- References — numeric footnotes
- About the author block

## Print CSS

```css
@page { size: Letter; margin: 0.75in; }
@media print {
  .no-print { display: none; }
  h1, h2, h3 { break-after: avoid; }
  table { break-inside: avoid; }
}
```

PDF export via headless Chrome / browser print. Verify the document looks
right at Letter (US) and A4 (intl) by adding both `@page` rules.

## Copy / voice rules

- **Proposal / invoice**: precise, formal, no marketing fluff. Numbers labeled.
- **Case study**: third-person, results-led, one specific anecdote
- **Pitch deck**: punchy, one idea per slide, big numbers
- **Whitepaper**: authoritative, citations, neutral tone

Currency formatted to locale. Dates spelled out (Mar 12, 2026), never ambiguous (3/12/26).

## Security rules (hard, enforced)

- **NO `<script>` tags anywhere.** PDFs with active script don't render
  reliably across viewers and create attack surface
- No external `<iframe>`
- Forms allowed only when the document is HTML-only and not for PDF export
- No tracking pixels, no analytics
- Do not embed real PII unless it's literally the document's purpose
  (an invoice has the client's billing info — that's fine; a case study
  should anonymize numbers if the client hasn't approved disclosure)
- Never include API keys, tokens, or credentials, even in code samples
  inside whitepapers (use `<your-api-key>` placeholders)

## Quality rules

- One `<h1>` per document
- Page breaks tested in print preview
- Tables have headers (`<thead>`) for accessibility + repeat on print
- All images have alt text
- Fonts load with `font-display: swap`
- Total file size with images < 5 MB so it emails cleanly

## Tool surface

Phase B (executor): `read_file`, `write_file`, `gen_image`
Phase B' (humanizer): `humanize_doc` for body copy
Phase C (polish): `read_file`, `write_file`, `pdf_proof` (renders to PDF and
visually checks page breaks)
