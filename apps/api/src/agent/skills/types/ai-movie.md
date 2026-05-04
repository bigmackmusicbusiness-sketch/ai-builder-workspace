# AI movie type SOP — runtime rules for executor + polish

This SOP applies to projects of type `ai-movie`. Long-form video (5–60+
minutes): short film, documentary, narrative feature. Output is a structured
script + scene plan + music cue sheet, not a finished render.

## File layout

```
script.json               # source of truth — full structured script
treatment.md              # 1–2 page logline + synopsis + tone
scenes/
  s01.json                # one file per scene with shot list
  s02.json
voiceover/
  s01_vo.txt              # narration / dialogue text per scene
  s02_vo.txt
music/
  cue-sheet.json          # music cues with timecodes
storyboards/
  s01_shot01.png          # optional gen-image storyboards
manifest.json             # top-level: title, runtime, acts, version
```

## script.json shape

```json
{
  "title": "The Last Signal",
  "logline": "A retired radio operator hears a voice from a station that went dark 40 years ago.",
  "runtimeMinutes": 18,
  "acts": [
    {
      "id": "act1",
      "title": "Setup",
      "startMinute": 0,
      "endMinute": 5,
      "scenes": ["s01", "s02", "s03"]
    },
    { "id": "act2", "title": "Confrontation", "startMinute": 5, "endMinute": 14, "scenes": ["s04","s05","s06","s07"] },
    { "id": "act3", "title": "Resolution",    "startMinute": 14, "endMinute": 18, "scenes": ["s08","s09"] }
  ]
}
```

## Three-act structure (enforced)

Every `ai-movie` plan must have exactly three acts:

- **Act 1 — Setup** (~25%): introduce protagonist, world, status quo, inciting
  incident at the act-1 turn
- **Act 2 — Confrontation** (~50%): rising stakes, midpoint reversal, all-is-lost
  beat near the act-2 turn
- **Act 3 — Resolution** (~25%): climax, denouement

## Scene file shape

```json
{
  "id": "s04",
  "act": "act2",
  "slugline": "INT. RADIO SHACK - NIGHT",
  "synopsis": "Henry tunes through static and hears the voice for the first time.",
  "durationSeconds": 95,
  "characters": ["HENRY"],
  "shots": [
    { "n": 1, "type": "ECU", "subject": "tuning dial", "duration": 4 },
    { "n": 2, "type": "MS",  "subject": "Henry leaning in", "duration": 6 },
    { "n": 3, "type": "OTS", "subject": "speaker, static resolves", "duration": 8 }
  ],
  "vo": "voiceover/s04_vo.txt",
  "musicCue": "cue-04"
}
```

Shot types use standard abbreviations: ECU, CU, MS, MWS, WS, OTS, POV, INSERT.

## Voiceover scripts

`voiceover/sNN_vo.txt` is plain text, one line per beat, with optional
inline cues:

```
[soft, weary]
This was supposed to be my last summer at the cabin.
[pause]
But the signal — the signal was waiting.
```

Brackets are direction; never read aloud.

## Music cue sheet

```json
{
  "cues": [
    { "id": "cue-01", "scene": "s01", "in": "00:00:12", "out": "00:01:34",
      "mood": "sparse-foreboding", "instruments": ["solo cello", "low drone"] },
    { "id": "cue-04", "scene": "s04", "in": "00:06:20", "out": "00:08:05",
      "mood": "rising-dread", "instruments": ["strings", "synth pulse"] }
  ]
}
```

The cue sheet drives the `music-studio` step if music is being generated for
the film.

## Copy / voice rules

- Loglines ≤ 30 words, name protagonist + situation + stakes
- Slug lines follow industry standard: `INT./EXT. LOCATION - TIME`
- Voiceover is conversational; avoid expository monologue dumps
- Scene synopses are present-tense, third-person ("Henry tunes...", not "Henry tuned...")

## Security rules (hard, enforced)

- Scripts NEVER include real living people unless they're explicitly public
  figures in a clearly factual context (documentary)
- No real trademarks as plot elements without legal sign-off; use plausible
  fictional names ("Halcyon Radio Co.", not "Sony")
- No depictions of real crimes against named individuals
- No prompts that would generate CSAM, non-consensual sexual content, or
  graphic real-world violence
- Voiceover scripts must not impersonate specific real performers' voices
- Reject scripts whose central premise requires defaming a named real person

## Quality rules

- Every scene resolves a setup or seeds a payoff (no orphan scenes)
- Act-1 turn lands at ~25% mark, act-2 turn at ~75%
- Total runtime in `manifest.json` matches sum of scene `durationSeconds`
- Each character introduced has at least one distinguishing trait beyond name
- Music cues align to scene boundaries unless explicitly bridging

## Tool surface

Phase B (executor): `read_file`, `write_file`, `gen_image` (storyboards),
`gen_audio` (voiceover dry reads, optional)
Phase B' (humanizer): `humanize_doc` for VO text
Phase C (polish): `read_file`, `write_file`, `script_lint` (slug-line
formatting + act-break checks)
