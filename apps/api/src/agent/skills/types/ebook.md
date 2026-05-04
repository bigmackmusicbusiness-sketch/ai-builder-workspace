# Ebook type SOP — runtime rules for executor + polish

This SOP applies to projects of type `ebook`. KDP-ready manuscript output:
fiction or non-fiction book with full front matter, chapters, back matter,
and a cover specification ready for upload.

## File layout

```
manuscript.docx           # primary deliverable (KDP accepts .docx + .epub)
manuscript.md             # source of truth, converted to .docx via pandoc
chapters/
  00-front-title.md
  00-front-copyright.md
  00-front-toc.md         # auto-generated from chapter list
  00-front-dedication.md
  00-front-foreword.md    # optional
  01-chapter-1.md
  02-chapter-2.md
  ...
  zz-back-acknowledgments.md
  zz-back-about-author.md
  zz-back-also-by.md
cover/
  cover-spec.json         # dimensions, fonts, color, imagery brief
  cover-front.jpg         # 1600×2560, 300 DPI
  cover-full-wrap.pdf     # spine + back, generated when print is in scope
metadata.json             # title, subtitle, author, isbn, categories, keywords
README.md
```

## Required front matter (in order)

1. **Title page** — title, subtitle, author name, publisher (optional)
2. **Copyright page** — copyright notice, edition, ISBN (if assigned),
   "All rights reserved" boilerplate, publisher imprint, disclaimer
3. **Dedication** — single short line, italicized, centered
4. **Table of Contents** — auto-generated, links by chapter title
5. **Foreword / Preface** — optional, written by author or guest

## Required back matter (in order)

1. **Acknowledgments** — short, sincere, names spelled correctly
2. **About the Author** — third person, 100–200 words, ends with website / email
3. **Also by [Author]** — list of other titles with linked ASINs (if Amazon)
4. **Reader request** — soft ask for an honest review (KDP-allowed phrasing only)

## Chapter structure

Each chapter is a separate Markdown file with the title at the top:

```markdown
# Chapter 1 — The Last Signal

The radio had been silent for forty years before Henry heard it again.

He turned the tuning knob slowly, listening past the static for the voice
he wasn't sure he remembered.
```

- Chapter titles are h1 in source, mapped to "Heading 1" style in .docx
- Section breaks within a chapter use `***` centered (mapped to a styled break)
- First paragraph of a chapter has no indent; subsequent paragraphs use first-line indent (DOCX style)
- Chapter length: target consistency (e.g. 2,500–4,000 words for trade fiction)

## Copyright page template

```
Copyright © {{year}} {{author}}

All rights reserved. No part of this book may be reproduced or used in any
manner without the prior written permission of the copyright owner, except
for the use of brief quotations in a book review.

First edition {{year}}.

ISBN: {{isbn}}

Cover design by {{designer_or_author}}.

{{publisher_name_if_any}}
{{publisher_address_if_any}}

{{author_or_publisher_website}}
```

For fiction, add: "This is a work of fiction. Names, characters, places,
and incidents are products of the author's imagination..."

## Cover specification

`cover-spec.json`:

```json
{
  "trim": "6x9",
  "frontDimensionsPx": [1600, 2560],
  "dpi": 300,
  "title": "The Last Signal",
  "subtitle": "A Henry Cole Novel",
  "author": "J. M. Lyle",
  "fonts": { "title": "Cinzel", "subtitle": "Lato", "author": "Lato" },
  "palette": ["#0d1b2a", "#e0e1dd", "#bfa46f"],
  "imageryBrief": "Vintage radio in moonlight, fog, cinematic, no people, no text in image"
}
```

Hard cover/print rules:

- Front cover ≥ 1600×2560 px, JPG or TIFF, 300 DPI
- Title legible at thumbnail size (test at 200×320)
- No text within 0.25in of edges (bleed safety)
- Author name spelled identically across cover, title page, copyright, metadata

## Voice / copy rules

- Fiction: scene-driven, sensory detail, dialogue-tagged minimally ("said" defaults)
- Non-fiction: each chapter opens with a hook (story, statistic, question),
  closes with a takeaway summary
- Avoid AI-tell phrases ("In this chapter, we will...", "It's important to note that...")
- Run the humanizer over the full manuscript; AI rhythm bleeds into prose fast

## Metadata.json

```json
{
  "title": "The Last Signal",
  "subtitle": "A Henry Cole Novel",
  "author": "J. M. Lyle",
  "language": "en",
  "categories": ["Fiction > Mystery, Thriller & Suspense > Suspense"],
  "keywords": ["small town mystery", "radio operator", "cold case", "1980s setting", "literary suspense", "rural noir", "amateur sleuth"],
  "ageRange": "Adult",
  "wordCount": 78000,
  "isbn": ""
}
```

Use 7 keywords (KDP cap). Use BISAC-formatted categories.

## Security rules (hard, enforced)

- No copyrighted excerpts > fair use length (typically ≤ 250 words from a
  prose work, ≤ 2 lines from a poem, **0 lines from any song lyric**)
- Song lyrics: never quoted; reference by title + artist only
- No real living people as characters in fiction without consent /
  clear satire framing
- Direct quotes from real public figures must be sourced and accurate (non-fiction)
- Cover imagery must not include trademarked logos, recognizable brands,
  or AI-generated likenesses of real people
- ISBN is the author's own; never invent or reuse another book's ISBN
- Disclaimer text on copyright page must be tailored: fiction disclaimer for
  fiction, "not medical/legal/financial advice" disclaimer for relevant non-fiction

## KDP quality checklist (polish phase enforces)

- Front + back matter present and in correct order
- All chapter titles formatted as Heading 1 in .docx
- Embedded fonts (or use KDP-safe defaults: Garamond, Bookerly, Times)
- No active hyperlinks to competitor retailers in text body
- Page break before each chapter
- Spell-check passed; manual proofread flag in README
- Cover passes KDP cover calculator dimensions for the spine width

## Tool surface

Phase B (executor): `read_file`, `write_file`, `gen_image` (cover art),
`md_to_docx` (pandoc wrapper)
Phase B' (humanizer): `humanize_doc` per chapter
Phase C (polish): `read_file`, `write_file`, `manuscript_lint` (front/back
matter check, heading style check), `kdp_cover_check`, `copyright_scan`
