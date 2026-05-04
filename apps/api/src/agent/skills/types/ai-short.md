# AI short type SOP — runtime rules for executor + polish

This SOP applies to projects of type `ai-short`. 15–60s vertical (9:16) video
for TikTok / Reels / Shorts. Single beat, hook fast, payoff fast.

## File layout

```
brief.json                # platform, duration, audio choice, hashtags
script.json               # hook + body + payoff with timecodes
shots.json                # shot list, vertical safe zones flagged
captions.srt              # baked-in captions, frame-aligned
audio/
  trending.json           # trending track ref + timestamp to sync to
  vo.wav                  # optional voiceover (often replaced by trending audio)
storyboards/shot-NN.png
manifest.json             # title, durationSeconds, platform
```

## Three-part structure (single-beat)

Unlike commercials, shorts have one core beat with a hook and a payoff. Padding
kills retention.

| Part    | 15s     | 30s     | 60s     | Job to do                                |
|---------|---------|---------|---------|------------------------------------------|
| Hook    | 0–1.5s  | 0–1.5s  | 0–2s    | Promise the payoff, in motion            |
| Body    | 1.5–12s | 1.5–25s | 2–55s   | Deliver the demonstration / story        |
| Payoff  | 12–15s  | 25–30s  | 55–60s  | The reveal / punchline / value statement |

**Hard rule: hook lands within the first 1.5 seconds.** Static title cards on
frame 1 are forbidden. The hook must be motion + a question / surprise / promise.

## Vertical safe zones (9:16, 1080×1920)

Platform UI overlays eat the top and bottom of the frame. Keep critical
content inside the safe zone:

- Top 220px: covered by username / handle area on TikTok and Reels
- Bottom 480px: covered by caption text + action rail
- Right 180px: covered by like/comment/share buttons

Title text, faces, product reveals, and captions belong in the central
1080×1220 area.

## Captions

Always baked-in (most viewers watch sound-off). Constraints:

- 2 lines max, ≤ 7 words per line
- Center-aligned, positioned at ~70% of frame height
- High-contrast outline (white text + 4px black stroke)
- Shown 200ms before audio, removed 200ms after
- Active word highlighted (karaoke-style) for retention

## script.json shape

```json
{
  "title": "Why your coffee tastes burnt",
  "durationSeconds": 30,
  "hook": {
    "in": "00:00.00",
    "out": "00:01.50",
    "vo": "Your espresso shouldn't taste like a campfire.",
    "visual": "Pull shot, dark crema falling, jump cut to grimace"
  },
  "body": [
    { "in": "00:01.50", "out": "00:08.00",
      "vo": "Most home setups extract too long at too high a temperature.",
      "visual": "Side-by-side thermometer + timer overlay" },
    { "in": "00:08.00", "out": "00:25.00",
      "vo": "Drop temp to 92C, target 25 seconds, watch what happens.",
      "visual": "Demo on machine with on-screen settings" }
  ],
  "payoff": {
    "in": "00:25.00",
    "out": "00:30.00",
    "vo": "That's espresso, not charcoal.",
    "visual": "Tasting reaction, satisfied nod, brand mark in corner"
  }
}
```

## Trending audio sync

If `brief.audio.kind === 'trending'`:

- The brief includes the audio's BPM and a list of "drop" timestamps
- Visual cuts align to the nearest beat (within ±50ms)
- The hook beat lands on or just before the audio's first hit
- VO is mixed under or replaced entirely; trending audio is the score

If `brief.audio.kind === 'vo'`, full VO drives pacing and music sits in bg.

## Copy / voice rules

- Hook is a contrarian claim, a question, or a visible "wait, what?" moment
- Body is one demonstration, one story, or one list — never two
- Payoff names the takeaway in plain language ("That's how", "That's why")
- Hashtags in the brief, not on screen
- One CTA at most, and only on educational / brand shorts (never on entertainment shorts)

## Security rules (hard, enforced)

- No copyrighted audio unless the platform-provided trending track is being
  referenced (the platform handles licensing; we don't embed the file)
- No real-people faces in storyboards unless the brief explicitly flags
  influencer-creator content with consent
- No misleading claims (medical, financial, "this one trick" formats that promise outcomes)
- Hashtags must not include trademarked terms unless owned by the advertiser
- Captions must accurately reflect VO; no clickbait caption / contradicting voice
- Reject prompts that produce harmful challenges or stunts

## Quality rules

- Hook scored on a 0–10 retention model; below 6 → regenerate
- Average shot length ≤ 2.0s; if longer, motion or zoom must be present
- Brand mark, if shown, no larger than 12% of frame area
- Loudness normalized to platform spec (TikTok ≈ -10 LUFS, Reels ≈ -14 LUFS)

## Tool surface

Phase B (executor): `read_file`, `write_file`, `gen_image` (storyboards),
`gen_audio` (VO), `gen_video`
Phase B' (humanizer): `humanize_doc` on VO + caption copy
Phase C (polish): `read_file`, `write_file`, `caption_align` (frame-accurate
caption check), `safe_zone_check`
