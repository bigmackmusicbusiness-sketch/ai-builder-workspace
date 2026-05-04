# AI music video type SOP — runtime rules for executor + polish

This SOP applies to projects of type `ai-music-video`. Visuals synced to a
provided audio track. Output is a scene plan with beat-aligned shot timings,
optional lyric overlays, and an energy curve that maps to the song.

## File layout

```
brief.json                  # track metadata, owner/license, aspect, lyric mode
audio/
  track.wav                 # the source audio (provided by user, never generated)
  beats.json                # detected beats, downbeats, BPM, sections
energy.json                 # 0..1 visual intensity curve, sampled per second
scenes.json                 # scene boundaries with start/end timecodes
shots.json                  # shot list with beat-aligned cuts
lyrics.json                 # optional: timestamped lyrics for overlays
storyboards/scene-NN.png
manifest.json               # title, artist, durationSeconds, aspect
```

## Inputs the planner provides

The user uploads or licenses the audio track. The planner also provides:

- `bpm`, `key`, `timeSignature` (detected or user-provided)
- `sections`: intro, verse, pre-chorus, chorus, bridge, outro with timestamps
- `licensed: true` flag — must be present, or the project is rejected at plan time

## Beat sync rules

`audio/beats.json` is generated from the track:

```json
{
  "bpm": 124.0,
  "downbeats": [0.48, 2.42, 4.36, 6.30, "..."],
  "beats":     [0.48, 0.96, 1.45, 1.93, 2.42, "..."],
  "sections": [
    { "name": "intro",     "in": 0.00,  "out": 15.48 },
    { "name": "verse-1",   "in": 15.48, "out": 46.45 },
    { "name": "chorus-1",  "in": 46.45, "out": 77.42 }
  ]
}
```

Cuts land on beats. Major scene changes land on downbeats or section boundaries.
Tolerance: ±40ms from the beat. Anything looser reads as out of sync.

## Energy curve

`energy.json` is the song's perceived intensity, normalized 0..1, sampled
per second. The visual plan mirrors it:

- 0.0–0.3 → static/contemplative shots, low motion, wide compositions
- 0.3–0.6 → moderate movement, character-driven, tighter framing
- 0.6–0.85 → fast cuts, push-ins, color saturation rising
- 0.85–1.0 → climax, performance shots, max motion + light energy

Cut frequency tracks energy: average shot length ≈ `2.0 - (energy * 1.4)` seconds.

## Multi-scene structure

A typical music video has 4–8 scene worlds that intercut. Each scene has:

- A consistent location, character, and color palette
- A role in the narrative (performance / B-roll / story / abstract)
- A defined energy band where it appears most heavily

Cross-cutting between scenes happens on downbeats. Within a scene, cuts can
happen on any beat.

## Lyric overlays (optional)

`lyrics.json` is opt-in. When enabled:

```json
{
  "mode": "kinetic",
  "lines": [
    { "in": 16.00, "out": 18.20, "text": "Walking through the city lights" },
    { "in": 18.20, "out": 20.40, "text": "Knew I'd find you here tonight" }
  ]
}
```

Modes:
- `none` — no overlays
- `subtle` — bottom-third caption styling, low opacity
- `kinetic` — animated typography synced to the lyric word-by-word

Lyric overlays must respect vertical safe zones if aspect is 9:16.

## scenes.json + shots.json shape

```json
// scenes.json
{
  "scenes": [
    { "id": "performance", "world": "neon studio", "energyBand": [0.6, 1.0] },
    { "id": "story",       "world": "rainy rooftop", "energyBand": [0.2, 0.7] },
    { "id": "abstract",    "world": "liquid color",   "energyBand": [0.4, 0.9] }
  ]
}

// shots.json
{
  "shots": [
    { "n": 1, "scene": "story", "in": 0.00,  "out": 3.86, "type": "WS", "subject": "rooftop, city below" },
    { "n": 2, "scene": "story", "in": 3.86,  "out": 5.80, "type": "MS", "subject": "subject's silhouette" },
    { "n": 3, "scene": "performance", "in": 5.80, "out": 7.74, "type": "MCU", "subject": "vocals into mic" }
  ]
}
```

## Aspect ratio

- 16:9 horizontal — YouTube primary
- 9:16 vertical — TikTok / Reels / Shorts cuts (often a separate edit)
- 1:1 square — legacy / feed previews

If the plan requests both 16:9 and 9:16, generate compositions that work in
the central 9:16 safe area for the vertical cut.

## Security rules (hard, enforced)

- The audio track MUST be flagged `licensed: true` in the brief, with a
  `licenseSource` field (artist-owned / licensed library / sync agreement)
- No track is generated for `ai-music-video`; we only sync to a provided file.
  If the user wants generated audio, that's `music-studio`
- No real-artist likenesses, voice, or named visual references unless the
  user has documented rights
- No imagery that defames named real people
- Lyric text must match the licensed lyrics; do not generate / paraphrase lyrics
- No visual content depicting illegal or harmful acts
- Reject briefs that include hate symbols or extremist imagery prompts

## Quality rules

- 95%+ of cuts within ±40ms of a detected beat
- Shot length distribution matches the energy curve (kept in spec via polish check)
- No more than 4s of black/empty frame across the entire piece
- Loudness preserved from source — do not re-encode audio, only mux video to it
- Color treatment consistent within each scene world

## Tool surface

Phase B (executor): `read_file`, `write_file`, `gen_image` (storyboards),
`gen_video` (per-scene clips), `audio_analyze` (beat / section detect)
Phase B' (humanizer): not applicable
Phase C (polish): `read_file`, `write_file`, `beat_sync_check` (frame-accurate
verification), `license_check`
