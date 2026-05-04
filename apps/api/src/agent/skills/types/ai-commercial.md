# AI commercial type SOP — runtime rules for executor + polish

This SOP applies to projects of type `ai-commercial`. Short-form ads at three
fixed durations: 15s, 30s, or 60s. Output is a structured script + shot list +
voiceover + music cue ready for production.

## File layout

```
brief.json                # product, audience, offer, channel, duration
script.json               # the four-beat structure, with timecodes
shots.json                # shot-by-shot list with durations
voiceover/vo.txt          # narration script
music/cue.json            # music brief for the score
storyboards/shot-NN.png   # optional gen-image storyboards
endcard.png               # 1080×1080 + 1920×1080 endcard with logo + CTA
manifest.json             # title, durationSeconds, channel, premium flag
```

## Required four-beat structure

Every commercial follows this skeleton. Beat lengths scale with total duration:

| Beat       | 15s      | 30s      | 60s      | Job to do                        |
|------------|----------|----------|----------|----------------------------------|
| Hook       | 0–2s     | 0–3s     | 0–5s     | Stop the scroll. Pattern interrupt. |
| Problem    | 2–6s     | 3–10s    | 5–18s    | Name the audience pain.          |
| Solution   | 6–12s    | 10–24s   | 18–48s   | Show the product solving it.     |
| CTA        | 12–15s   | 24–30s   | 48–60s   | One clear action + endcard.      |

The CTA beat MUST hold the endcard for ≥ 1.5s with logo + verb-led CTA visible.

## script.json shape

```json
{
  "title": "Halcyon Radio - 30s spot",
  "durationSeconds": 30,
  "beats": [
    { "name": "hook",     "in": "00:00.00", "out": "00:03.00",
      "vo": "What if the most important call of your life came in 1984?",
      "visual": "ECU on glowing tube, dust in light beam" },
    { "name": "problem",  "in": "00:03.00", "out": "00:10.00",
      "vo": "Every day, family stories disappear forever.",
      "visual": "B-roll of attic boxes, fading photos" },
    { "name": "solution", "in": "00:10.00", "out": "00:24.00",
      "vo": "Halcyon turns old recordings into searchable audio archives.",
      "visual": "Hands placing reel onto scanner, waveform appears on screen" },
    { "name": "cta",      "in": "00:24.00", "out": "00:30.00",
      "vo": "Start your archive. Halcyon dot com.",
      "visual": "Endcard: logo, URL, free-trial badge" }
  ]
}
```

## Pacing rules

- Average shot length: 1.2s for 15s spots, 1.8s for 30s, 2.5s for 60s
- Hook visual changes within first 1.0s (motion or reveal, not a static logo)
- VO line ≤ 12 words per breath
- Music drop / lift on the solution beat boundary
- Endcard text big enough to read on a 5" phone at arm's length (~48pt eq.)

## Copy / voice rules

- Hook is a question, contrast, or visual surprise — never the brand name
- Problem stated in customer language, not category jargon
- Solution copy is benefit-led ("save 4 hours a week"), not feature-led
- CTA is a verb phrase ("Start your archive", not "Click here")
- One offer per spot. Two offers = both forgotten.
- Brand name appears at least once in VO; URL only in endcard

## Premium model gating

The plan may flag `premium: true`. Premium spots:

- Use the higher-tier video generation model
- Allow up to 3 location changes (vs 1 for standard)
- Allow on-screen talent (vs product-only for standard)
- Cap at 60s; 15s/30s premium spots are over-produced for the format

Non-premium spots use the standard generator and the constraints above.

## Channel-specific rules

The `brief.json` declares `channel`:

- `youtube-preroll` — 15s skippable, hook in 0–1s, brand mention in first 5s
- `instagram-reel` — 9:16 vertical, captions baked-in, CTA on endcard
- `ctv` — 15/30s, 1080p horizontal, no URL (use brand name + "search:" prompt)
- `meta-feed` — 4:5 or 1:1 aspect, captions baked-in, sound-off-friendly

## Security rules (hard, enforced)

- No claims that can't be substantiated ("clinically proven" requires evidence)
- No comparative claims naming competitors without proof
- No celebrity likenesses, voices, or named-impersonation prompts
- No copyrighted music — use original score or licensed library only
- Health, finance, gambling, alcohol categories require disclaimers per channel rules
- No targeting children with claims under 13 (COPPA-sensitive)
- Endcard logos and trademarks must be the advertiser's own (verified in brief)
- Captions accuracy — never paraphrase legal disclaimers

## Quality rules

- Total duration matches one of {15, 30, 60}; no other lengths
- Beat durations sum to total within ±0.1s
- Endcard exported in both 1:1 and 16:9 (and 9:16 if vertical channel)
- Voiceover loudness normalized to channel spec (YT ≈ -14 LUFS, broadcast ≈ -24 LKFS)

## Tool surface

Phase B (executor): `read_file`, `write_file`, `gen_image` (storyboard +
endcard), `gen_audio` (VO scratch), `gen_video` (gated by premium flag)
Phase B' (humanizer): `humanize_doc` for VO + endcard copy
Phase C (polish): `read_file`, `write_file`, `script_lint` (beat timing),
`brand_safety_scan`
