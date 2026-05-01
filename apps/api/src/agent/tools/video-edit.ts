// apps/api/src/agent/tools/video-edit.ts — agent-facing video timeline ops.
//
// The agent never holds the full timeline JSON in context. Instead it issues
// these structured tool calls; each one mutates the server-side timeline and
// returns a compact diff + summary (≤ ~500 tokens).
//
// Why context-safe matters: a 5-minute movie timeline has ~30 clips +
// ~50 captions. Sending it raw on every turn would blow the context window
// inside ~3 turns. Pulling clip-list summaries (id + 1-line desc) keeps the
// agent oriented without bloat.
//
// All tools require an active video project id; we resolve it from the
// agent's current chat context (the user is on the editor screen for that
// project).

import type { ToolDefinition } from '@abw/providers';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { videoProjects } from '@abw/db';
import { summariseTimeline, type Timeline, type VideoClip, type Overlay } from '../../lib/timeline';

// ── Tool definitions exposed to the LLM ───────────────────────────────────────

export const VIDEO_EDIT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'video_summary',
      description: 'Get a compact summary of a video project timeline: duration, clip counts, overlay counts. Returns ~5 fields, no full clip data.',
      parameters: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string', description: 'video_projects.id (UUID)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'video_list_clips',
      description: 'List the video clips on a timeline with id + start time + duration. NOT the source assets — just enough to reference each clip. Returns < 20 items.',
      parameters: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string', description: 'video_projects.id' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'video_cut_clip',
      description: 'Split a video clip into two at a given time within the clip. Useful when the user wants to "cut at the 3-second mark of clip 2".',
      parameters: {
        type: 'object',
        required: ['videoId', 'clipId', 'atSec'],
        properties: {
          videoId: { type: 'string' },
          clipId:  { type: 'string' },
          atSec:   { type: 'number', description: 'Time within the clip (relative to its `in`) where the split occurs.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'video_trim_clip',
      description: 'Adjust a video clip\'s in/out points (shorten or extend within the source).',
      parameters: {
        type: 'object',
        required: ['videoId', 'clipId'],
        properties: {
          videoId: { type: 'string' },
          clipId:  { type: 'string' },
          newIn:   { type: 'number', description: 'New start within source (seconds).' },
          newOut:  { type: 'number', description: 'New end within source (seconds).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'video_delete_clip',
      description: 'Remove a clip from the timeline. Subsequent clips slide left to fill the gap.',
      parameters: {
        type: 'object',
        required: ['videoId', 'clipId'],
        properties: {
          videoId: { type: 'string' },
          clipId:  { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'video_reorder_clips',
      description: 'Reorder the video track\'s clips. Pass the desired clip-id sequence.',
      parameters: {
        type: 'object',
        required: ['videoId', 'clipIds'],
        properties: {
          videoId:  { type: 'string' },
          clipIds:  { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'video_add_caption',
      description: 'Add a caption overlay (bottom-third white text on dark box, viral preset).',
      parameters: {
        type: 'object',
        required: ['videoId', 'text', 'startSec', 'endSec'],
        properties: {
          videoId:  { type: 'string' },
          text:     { type: 'string' },
          startSec: { type: 'number' },
          endSec:   { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'video_set_transition',
      description: 'Set a clip transition (cut, fade, dissolve) on a clip\'s in or out edge.',
      parameters: {
        type: 'object',
        required: ['videoId', 'clipId', 'edge', 'kind'],
        properties: {
          videoId:    { type: 'string' },
          clipId:     { type: 'string' },
          edge:       { type: 'string', enum: ['in', 'out'] },
          kind:       { type: 'string', enum: ['cut', 'fade', 'dissolve'] },
          durationSec:{ type: 'number', description: 'Transition duration. Default 0.5.' },
        },
      },
    },
  },
];

// ── Executor (called from agent/tools.ts dispatcher) ──────────────────────────

export interface VideoEditCtx {
  tenantId: string;
}

export interface VideoEditResult {
  ok: boolean;
  summary: string;
  result: string;     // JSON string fed back to the model
}

/** Load a tenant-owned video project's timeline; throws if not found. */
async function loadTimeline(tenantId: string, videoId: string): Promise<{ row: typeof videoProjects.$inferSelect; timeline: Timeline }> {
  const db = getDb();
  const [row] = await db.select().from(videoProjects)
    .where(and(eq(videoProjects.id, videoId), eq(videoProjects.tenantId, tenantId)));
  if (!row) throw new Error(`Video project ${videoId} not found`);
  return { row, timeline: row.timeline as unknown as Timeline };
}

async function saveTimeline(tenantId: string, videoId: string, t: Timeline): Promise<void> {
  t.meta.lastEditedAt = Date.now();
  // Recompute durationSec from the rightmost clip end
  let max = 0;
  for (const c of t.tracks[0].clips) {
    const end = c.start + (c.out - c.in);
    if (end > max) max = end;
  }
  t.durationSec = max;
  const db = getDb();
  await db.update(videoProjects).set({
    timeline:    t as unknown as object,
    durationSec: t.durationSec,
    updatedAt:   new Date(),
  }).where(and(eq(videoProjects.id, videoId), eq(videoProjects.tenantId, tenantId)));
}

export async function execVideoEdit(
  toolName: string,
  args:     Record<string, unknown>,
  ctx:      VideoEditCtx,
): Promise<VideoEditResult> {
  const videoId = String(args['videoId'] ?? '');
  if (!videoId) return { ok: false, summary: 'videoId required', result: 'Error: videoId is required' };

  switch (toolName) {
    case 'video_summary': {
      const { timeline } = await loadTimeline(ctx.tenantId, videoId);
      const s = summariseTimeline(timeline);
      return {
        ok: true,
        summary: `Timeline: ${s.videoClipCount} clips, ${s.overlayCount} overlays, ${s.durationSec}s`,
        result: JSON.stringify(s),
      };
    }

    case 'video_list_clips': {
      const { timeline } = await loadTimeline(ctx.tenantId, videoId);
      const compact = timeline.tracks[0].clips.map((c) => ({
        id:          c.id,
        startSec:    c.start,
        durationSec: c.out - c.in,
      }));
      return {
        ok: true,
        summary: `${compact.length} clips`,
        result: JSON.stringify(compact),
      };
    }

    case 'video_cut_clip': {
      const clipId = String(args['clipId'] ?? '');
      const atSec  = Number(args['atSec'] ?? 0);
      const { timeline } = await loadTimeline(ctx.tenantId, videoId);
      const idx = timeline.tracks[0].clips.findIndex((c) => c.id === clipId);
      if (idx < 0) return { ok: false, summary: `Clip ${clipId} not found`, result: 'Error: clipId not found' };
      const orig = timeline.tracks[0].clips[idx]!;
      if (atSec <= 0 || atSec >= (orig.out - orig.in)) {
        return { ok: false, summary: 'atSec must be inside the clip', result: 'Error: cut point outside clip duration' };
      }
      const left:  VideoClip = { ...orig, id: `${orig.id}-a`, out: orig.in + atSec };
      const right: VideoClip = { ...orig, id: `${orig.id}-b`, in:  orig.in + atSec, start: orig.start + atSec };
      timeline.tracks[0].clips.splice(idx, 1, left, right);
      await saveTimeline(ctx.tenantId, videoId, timeline);
      return {
        ok: true,
        summary: `Split clip ${clipId} at ${atSec}s`,
        result: JSON.stringify({ before: clipId, after: [left.id, right.id] }),
      };
    }

    case 'video_trim_clip': {
      const clipId = String(args['clipId'] ?? '');
      const { timeline } = await loadTimeline(ctx.tenantId, videoId);
      const clip = timeline.tracks[0].clips.find((c) => c.id === clipId);
      if (!clip) return { ok: false, summary: `Clip ${clipId} not found`, result: 'Error: clipId not found' };
      if (args['newIn']  !== undefined) clip.in  = Number(args['newIn']);
      if (args['newOut'] !== undefined) clip.out = Number(args['newOut']);
      if (clip.in >= clip.out) return { ok: false, summary: 'Invalid trim — in >= out', result: 'Error: trim invalid' };
      // Re-pack subsequent clips' start times
      let cursor = 0;
      for (const c of timeline.tracks[0].clips) {
        c.start = cursor;
        cursor += c.out - c.in;
      }
      await saveTimeline(ctx.tenantId, videoId, timeline);
      return {
        ok: true,
        summary: `Trimmed ${clipId} to ${(clip.out - clip.in).toFixed(1)}s`,
        result: JSON.stringify({ id: clip.id, in: clip.in, out: clip.out }),
      };
    }

    case 'video_delete_clip': {
      const clipId = String(args['clipId'] ?? '');
      const { timeline } = await loadTimeline(ctx.tenantId, videoId);
      const before = timeline.tracks[0].clips.length;
      timeline.tracks[0].clips = timeline.tracks[0].clips.filter((c) => c.id !== clipId);
      if (timeline.tracks[0].clips.length === before) {
        return { ok: false, summary: `Clip ${clipId} not found`, result: 'Error: clipId not found' };
      }
      let cursor = 0;
      for (const c of timeline.tracks[0].clips) {
        c.start = cursor;
        cursor += c.out - c.in;
      }
      await saveTimeline(ctx.tenantId, videoId, timeline);
      return {
        ok: true,
        summary: `Deleted ${clipId}, ${timeline.tracks[0].clips.length} clips remain`,
        result: JSON.stringify({ deleted: clipId, remaining: timeline.tracks[0].clips.length }),
      };
    }

    case 'video_reorder_clips': {
      const clipIds = (args['clipIds'] as string[]) ?? [];
      const { timeline } = await loadTimeline(ctx.tenantId, videoId);
      const map = new Map(timeline.tracks[0].clips.map((c) => [c.id, c]));
      const ordered: VideoClip[] = [];
      for (const id of clipIds) {
        const c = map.get(id);
        if (c) ordered.push(c);
      }
      if (ordered.length !== timeline.tracks[0].clips.length) {
        return { ok: false, summary: 'Reorder must include every clip exactly once', result: 'Error: clipIds count mismatch' };
      }
      let cursor = 0;
      for (const c of ordered) { c.start = cursor; cursor += c.out - c.in; }
      timeline.tracks[0].clips = ordered;
      await saveTimeline(ctx.tenantId, videoId, timeline);
      return { ok: true, summary: `Reordered ${ordered.length} clips`, result: JSON.stringify({ order: clipIds }) };
    }

    case 'video_add_caption': {
      const text     = String(args['text'] ?? '');
      const startSec = Number(args['startSec'] ?? 0);
      const endSec   = Number(args['endSec'] ?? startSec + 3);
      const { timeline } = await loadTimeline(ctx.tenantId, videoId);
      const overlay: Overlay = {
        id:    `cap-${Date.now()}`,
        kind:  'caption',
        start: startSec,
        end:   endSec,
        props: { text, color: '#ffffff' },
      };
      timeline.overlays.push(overlay);
      await saveTimeline(ctx.tenantId, videoId, timeline);
      return { ok: true, summary: `Added caption "${text.slice(0, 30)}…"`, result: JSON.stringify({ overlayId: overlay.id }) };
    }

    case 'video_set_transition': {
      const clipId      = String(args['clipId'] ?? '');
      const edge        = (args['edge'] as 'in' | 'out');
      const kind        = (args['kind'] as 'cut' | 'fade' | 'dissolve');
      const durationSec = Number(args['durationSec'] ?? 0.5);
      const { timeline } = await loadTimeline(ctx.tenantId, videoId);
      const clip = timeline.tracks[0].clips.find((c) => c.id === clipId);
      if (!clip) return { ok: false, summary: `Clip ${clipId} not found`, result: 'Error: clipId not found' };
      if (edge === 'in')  clip.transitionIn  = { kind, durationSec };
      else                clip.transitionOut = { kind, durationSec };
      await saveTimeline(ctx.tenantId, videoId, timeline);
      return { ok: true, summary: `Set ${edge} transition on ${clipId} to ${kind}`, result: JSON.stringify({ id: clipId, edge, kind, durationSec }) };
    }

    default:
      return { ok: false, summary: `Unknown video edit tool: ${toolName}`, result: 'Error: unknown tool' };
  }
}
