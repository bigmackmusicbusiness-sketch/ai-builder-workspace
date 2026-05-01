// apps/api/src/lib/timeline.ts — video timeline data model.
//
// SHAPE OF video_projects.timeline (JSONB):
// {
//   fps: number,
//   width: number, height: number,
//   durationSec: number,
//   tracks: [
//     { id: 'video', kind: 'video', clips: VideoClip[] },
//     { id: 'audio', kind: 'audio', clips: AudioClip[] },
//   ],
//   overlays: Overlay[],   // captions, text, images
//   meta: { aiFirstPassAt?: number, lastEditedAt?: number },
// }
//
// The agent never reads the full timeline — it issues structured tool calls
// (apps/api/src/agent/tools/video-edit.ts) and gets compact summaries back.
// Frontend timeline editor (apps/web/.../VideoEditorScreen.tsx) reads/writes
// this directly via /api/video/:id endpoints.

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3';

export interface Transition {
  kind:        'cut' | 'fade' | 'dissolve';
  durationSec: number;
}

export interface VideoClip {
  id:            string;
  /** Asset row id of the source video. */
  sourceAssetId: string;
  /** Where in the source we start (seconds). */
  in:            number;
  /** Where in the source we stop (seconds). */
  out:           number;
  /** Where on the timeline this clip starts (seconds). */
  start:         number;
  transitionIn?: Transition;
  transitionOut?: Transition;
}

export interface AudioClip {
  id:            string;
  sourceAssetId: string;
  in:            number;
  out:           number;
  start:         number;
  /** 0–1 linear gain. */
  volume:        number;
}

export type OverlayKind = 'caption' | 'text' | 'image';

export interface Overlay {
  id:    string;
  kind:  OverlayKind;
  start: number;
  end:   number;
  /** Caption: { text, animation: 'word-by-word' | 'fade' | 'pop' }
   *  Text:    { text, font, size, color }
   *  Image:   { assetId, x, y, w, h } */
  props: Record<string, unknown>;
}

export interface VideoTrack {
  id:    'video';
  kind:  'video';
  clips: VideoClip[];
}

export interface AudioTrack {
  id:    'audio';
  kind:  'audio';
  clips: AudioClip[];
}

export interface Timeline {
  fps:         number;
  width:       number;
  height:      number;
  durationSec: number;
  tracks:      [VideoTrack, AudioTrack];
  overlays:    Overlay[];
  meta:        { aiFirstPassAt?: number; lastEditedAt?: number };
}

// ── Resolution presets per aspect ─────────────────────────────────────────

const RES: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1':  { width: 1080, height: 1080 },
  '4:3':  { width: 1440, height: 1080 },
};

export function emptyTimeline(opts: { aspectRatio: AspectRatio; fps?: number }): Timeline {
  const { width, height } = RES[opts.aspectRatio];
  return {
    fps:         opts.fps ?? 30,
    width,
    height,
    durationSec: 0,
    tracks: [
      { id: 'video', kind: 'video', clips: [] },
      { id: 'audio', kind: 'audio', clips: [] },
    ],
    overlays: [],
    meta:     {},
  };
}

/** Compact summary used by the agent (NOT the full timeline). */
export interface TimelineSummary {
  durationSec: number;
  videoClipCount: number;
  audioClipCount: number;
  overlayCount:   number;
  aiFirstPassAt?: number;
  lastEditedAt?:  number;
}

export function summariseTimeline(t: Timeline): TimelineSummary {
  return {
    durationSec:    t.durationSec,
    videoClipCount: t.tracks[0]?.clips.length ?? 0,
    audioClipCount: t.tracks[1]?.clips.length ?? 0,
    overlayCount:   t.overlays.length,
    aiFirstPassAt:  t.meta.aiFirstPassAt,
    lastEditedAt:   t.meta.lastEditedAt,
  };
}
