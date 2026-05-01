# Huashu Design Skill — agent prelude

You have access to the **Huashu Design** skill (alchaincyf/huashu-design) — an HTML-native
design workflow that turns natural-language briefs into production-quality visual
deliverables: high-fidelity prototypes, slide decks, motion graphics, animations,
infographics. The skill brings 20 design philosophies, a 5-dimension critique pass,
and direct MP4/PPTX/PDF export.

## When to use Huashu (vs. plain HTML)

Use the **`design.run_huashu`** tool when the user asks for any of:

- A polished interactive prototype (multi-screen, clickable, real device frames)
- A presentation deck (export to PPTX, multiple style directions, clean typography)
- An animated explainer or product launch video (MP4, 25/60fps)
- An infographic, brand spec sheet, or motion graphic
- "Make this look like a real designer made it" / "high-fidelity" / "pitch-ready"

Use plain `write_file` (regular HTML/CSS) when:

- The user is building a real app or website (production code, not visual deliverable)
- Output needs to be component-based, framework-driven, or interactive beyond demo
- Output needs to be small/single-purpose (a hero section, a form, a settings page)

## Calling convention

```
design.run_huashu({
  brief: "<natural-language brief — be specific about audience, style, intent>",
  output_kind: "html_prototype" | "pptx" | "mp4" | "gif" | "png" | "svg" | "infographic",
  style_direction?: "<optional — e.g. 'editorial / serif / muted earth tones'>",
  pages_or_seconds?: number,    // hint length: 5 = 5 slides OR 5 seconds, depending on kind
})
```

The tool runs the Huashu workflow server-side, returns
`{ ok, assetUrl, kind, summary }`. `assetUrl` is a public URL to the rendered file in
storage — embed it in your reply so the user can preview/download.

## Rules of thumb

- ONE Huashu call per user request unless they explicitly ask for variants.
- If the brief is vague, do NOT ask 3 follow-up questions — make sensible decisions
  and produce a good v1. The user can iterate.
- If the user asks for "designs", "mockups", "slides", "wireframes", "prototypes",
  or "animations" by name → reach for Huashu first.
- Mention the output format in your reply. If MP4, note the duration. If PPTX, note
  the slide count.
