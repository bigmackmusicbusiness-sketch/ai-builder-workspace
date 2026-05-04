# Music studio type SOP — runtime rules for executor + polish

This SOP applies to projects of type `music-studio`. Generates structured
music project files (DAW-importable stems + arrangement) for two top-level
modes: **beat** and **cinematic**.

## File layout

```
project.json              # arrangement, tempo, key, sections
README.md                 # how to import + what's where
stems/
  drums.wav               # rendered if generator is available
  bass.wav
  melody.wav
  fx.wav
midi/
  drums.mid
  bass.mid
  melody.mid
  chords.mid
preview.mp3               # 30-60s bounce of the full mix
artwork.jpg               # 1:1 cover art, 1400×1400+ for streaming
```

## project.json shape

```json
{
  "title": "Midnight Drive",
  "mode": "beat",
  "subgenre": "lo-fi",
  "bpm": 82,
  "key": "F# minor",
  "timeSignature": "4/4",
  "lengthBars": 64,
  "sections": [
    { "name": "intro",   "startBar": 1,  "lengthBars": 8 },
    { "name": "verse-a", "startBar": 9,  "lengthBars": 16 },
    { "name": "drop",    "startBar": 25, "lengthBars": 16 },
    { "name": "verse-b", "startBar": 41, "lengthBars": 16 },
    { "name": "outro",   "startBar": 57, "lengthBars": 8 }
  ],
  "stems": ["drums", "bass", "melody", "fx"]
}
```

## Beat mode

Subgenres + recommended ranges:

| subgenre  | BPM     | Common keys           | Drum feel                         |
|-----------|---------|------------------------|-----------------------------------|
| trap      | 130–160 | minor (often F#m, Cm)  | half-time hats, 808 sub, snares on 3 |
| lo-fi     | 70–90   | minor 7ths, jazzy      | swung kick/snare, vinyl noise, soft hats |
| boom-bap  | 85–95   | minor, blues           | hard kick on 1, snare on 3, off-beat hats |
| drill     | 140–150 | minor                  | sliding 808s, triplet hats, sparse snares |

Standard arrangement (beat): intro 8 → verse-A 16 → hook 8 → verse-B 16 →
hook 8 → outro 8.

## Cinematic mode

Subgenres:

| subgenre   | BPM     | Keys                    | Texture                                 |
|------------|---------|-------------------------|-----------------------------------------|
| orchestral | 60–90   | Cm, Dm, Em, modal       | strings, brass swells, timpani, choir   |
| ambient    | 60–80   | major 7ths, modal       | pads, granular textures, no drums       |
| tension    | 90–130  | Cm, Dm, dissonant       | risers, pulse, low brass, percussion hits |
| upbeat     | 100–130 | major, lydian           | pizz strings, claps, marimba, light brass |

Standard arrangement (cinematic): intro pad 8 → build 16 → climax 16 →
resolution 16 → tail 8.

## Stem layout rules

- `drums` and `bass` always exist for beat modes
- `melody` is the primary lead (chords or topline)
- `fx` carries risers, swells, vinyl, foley
- For ambient / cinematic without drums, omit the `drums` stem from the manifest
- All stems share the same start time (bar 1) and length so they import aligned

## Cover art

`artwork.jpg`:

- 1:1 aspect, ≥ 1400×1400 (streaming services require 3000×3000 for new releases)
- No copyrighted imagery, no recognizable trademarks, no third-party logos
- No text smaller than 24px equivalent (legal requirement on most DSPs)

## Copy / metadata rules

- Title is short and evocative, not a description
- Subgenre tags use lowercase canonical names (`lo-fi`, not `LoFi`)
- Key uses standard notation: `F# minor`, `C major` (not `F#m` in metadata fields)

## Security rules (hard, enforced)

- **NO `<script>` tags in any HTML preview pages**
- No samples from copyrighted recordings — generators must use synthesized or
  cleared sources
- No vocal samples that could be confused with a specific real performer
- Cover art generator must reject prompts naming real people or trademarks
- Project files must not embed external URLs that fetch on import
- No executable content in WAV/MIDI metadata fields

## Quality rules

- BPM stays inside subgenre range (manifest enforces)
- Key consistent across all stems
- Mix headroom: peak ≤ -1 dBFS, LUFS-I around -14 for streaming preview
- Preview mp3 is ≤ 60s, ≥ 192 kbps
- README lists DAW import steps for Ableton + Logic + FL

## Tool surface

Phase B (executor): `read_file`, `write_file`, `gen_audio`, `gen_midi`,
`gen_image` (cover art)
Phase B' (humanizer): not applicable
Phase C (polish): `read_file`, `audio_analyze` (LUFS + peak check),
`copyright_scan` on samples
