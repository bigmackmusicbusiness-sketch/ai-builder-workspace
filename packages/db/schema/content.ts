// packages/db/schema/content.ts — eBooks, Documents, Music, Visual Editor sessions.
import { pgTable, text, uuid, jsonb, integer, pgEnum, timestamp } from 'drizzle-orm/pg-core';
import { timestamps, tenants } from './core';
import { projects } from './projects';
import { assets } from './backend';

// ── eBook style (8 templates) ──────────────────────────────────────
export const ebookStyleEnum = pgEnum('ebook_style', [
  'professional_business',
  'lead_magnet',
  'narrative_story',
  'how_to_guide',
  'academic',
  'cookbook',
  'kdp_novel',
  'picture_book',
]);

// ── eBook mode: 'generate' = AI writes from scratch; 'format' = user provides text ──
export const ebookModeEnum = pgEnum('ebook_mode', ['generate', 'format']);

// ── Content status (shared by ebooks + documents) ──────────────────
export const contentStatusEnum = pgEnum('content_status', [
  'generating', 'ready', 'failed', 'cancelled',
]);

// ── eBooks ─────────────────────────────────────────────────────────
export const ebooks = pgTable('ebooks', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  projectId:         uuid('project_id').references(() => projects.id),
  title:             text('title').notNull(),
  topic:             text('topic'),
  audience:          text('audience'),
  tone:              text('tone'),
  genre:             text('genre'),           // novels only
  pov:               text('pov'),             // 'first'|'close_third'|'omniscient'
  style:             ebookStyleEnum('style').notNull(),
  /** 'generate' = AI writes the book; 'format' = user provides their manuscript. */
  mode:              ebookModeEnum('mode').notNull().default('generate'),
  /** Original user-supplied manuscript text for `mode='format'`. NULL for generated books. */
  rawManuscript:     text('raw_manuscript'),
  chapterCount:      integer('chapter_count').notNull().default(5),
  wordCountTarget:   integer('word_count_target').notNull().default(800),
  status:            contentStatusEnum('status').notNull().default('generating'),
  pdfAssetId:        uuid('pdf_asset_id').references(() => assets.id),
  epubAssetId:       uuid('epub_asset_id').references(() => assets.id),
  coverAssetId:      uuid('cover_asset_id').references(() => assets.id),
  kdpBundleAssetId:  uuid('kdp_bundle_asset_id').references(() => assets.id),
  /** { chapters: [{ title, summary, targetWords, prose? }], frontMatter, backMatter } */
  outline:           jsonb('outline').notNull().default({}),
  /** Array of cover variant asset ids produced by image-01. */
  coverVariants:     jsonb('cover_variants').notNull().default([]),
  error:             text('error'),
  ...timestamps,
});

// ── Document type (5 kinds) ────────────────────────────────────────
export const documentTypeEnum = pgEnum('document_type', [
  'business_proposal',
  'case_study',
  'project_report',
  'invoice',
  'pitch_deck',
]);

// ── Documents ──────────────────────────────────────────────────────
export const documents = pgTable('documents', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id),
  projectId: uuid('project_id').references(() => projects.id),
  title:     text('title').notNull(),
  docType:   documentTypeEnum('doc_type').notNull(),
  status:    contentStatusEnum('status').notNull().default('generating'),
  assetId:   uuid('asset_id').references(() => assets.id),
  /** Type-specific structured content. */
  content:   jsonb('content').notNull().default({}),
  error:     text('error'),
  ...timestamps,
});

// ── Music mode + status ────────────────────────────────────────────
export const musicModeEnum   = pgEnum('music_mode',   ['beat', 'cinematic']);
export const musicStatusEnum = pgEnum('music_status', [
  'generating', 'separating', 'packaging', 'ready', 'failed',
]);

// ── Music tracks ───────────────────────────────────────────────────
export const musicTracks = pgTable('music_tracks', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  projectId:      uuid('project_id').references(() => projects.id),
  title:          text('title').notNull(),
  mode:           musicModeEnum('mode').notNull(),
  /** Raw user inputs: vibe, bpm, key, duration, prompt */
  inputs:         jsonb('inputs').notNull().default({}),
  /** Orchestrator plan: { segments, structure, stemPreferences, fullPrompt } */
  generationPlan: jsonb('generation_plan').notNull().default({}),
  bpm:            integer('bpm'),
  key:            text('key'),
  durationSec:    integer('duration_sec'),
  mp3AssetId:     uuid('mp3_asset_id').references(() => assets.id),
  zipAssetId:     uuid('zip_asset_id').references(() => assets.id),
  status:         musicStatusEnum('status').notNull().default('generating'),
  costUsdCents:   integer('cost_usd_cents').notNull().default(0),
  error:          text('error'),
  ...timestamps,
});

// ── Editor target + action enums ───────────────────────────────────
export const editorTargetEnum = pgEnum('editor_target', ['website', 'ebook', 'email']);
export const editorSessionStatusEnum = pgEnum('editor_session_status', ['active', 'closed']);
export const editorActionEnum = pgEnum('editor_action', [
  'edit_text',
  'edit_attr',
  'edit_style',
  'replace_image',
  'delete_element',
  'duplicate_element',
  'reorder_siblings',
  'ai_rewrite',
]);

// ── Editor sessions ────────────────────────────────────────────────
export const editorSessions = pgTable('editor_sessions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  projectId:   uuid('project_id').references(() => projects.id),
  filePath:    text('file_path').notNull(),
  targetType:  editorTargetEnum('target_type').notNull(),
  /** Nullable link to ebook/document/email record (free text to avoid FK storm). */
  targetId:    text('target_id'),
  status:      editorSessionStatusEnum('status').notNull().default('active'),
  editCount:   integer('edit_count').notNull().default(0),
  lastEditAt:  timestamp('last_edit_at', { withTimezone: true }),
  ...timestamps,
});

// ── Editor edits (audit trail + undo/redo history) ─────────────────
export const editorEdits = pgTable('editor_edits', {
  id:        uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => editorSessions.id, { onDelete: 'cascade' }),
  action:    editorActionEnum('action').notNull(),
  selector:  text('selector').notNull(),
  /** { newText?, attr?, value?, property?, aiPrompt?, ... } */
  payload:   jsonb('payload').notNull().default({}),
  /** Links to versions row for rollback. */
  versionId: uuid('version_id'),
  actor:     text('actor').notNull(),     // user id or 'agent'
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Video Suite ───────────────────────────────────────────────────
export const videoKindEnum   = pgEnum('video_kind',   ['movie','commercial','short','music_video']);
export const videoStatusEnum = pgEnum('video_status', ['drafting','rendering','ready','failed']);

/**
 * One row per video project. The `timeline` JSONB is the single source of
 * truth (clips, overlays, captions, audio). The agent never holds the full
 * structure in context — it issues structured tool calls
 * (see apps/api/src/agent/tools/video-edit.ts) and gets back compact summaries.
 */
export const videoProjects = pgTable('video_projects', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  projectId:       uuid('project_id').references(() => projects.id),
  title:           text('title').notNull(),
  kind:            videoKindEnum('kind').notNull(),
  brief:           text('brief'),
  durationSec:     integer('duration_sec'),
  aspectRatio:     text('aspect_ratio').notNull().default('16:9'),
  status:          videoStatusEnum('status').notNull().default('drafting'),
  /** Timeline state — see lib/timeline.ts for shape. */
  timeline:        jsonb('timeline').notNull().default({}),
  previewAssetId:  uuid('preview_asset_id').references(() => assets.id),
  finalAssetId:    uuid('final_asset_id').references(() => assets.id),
  costUsdCents:    integer('cost_usd_cents').notNull().default(0),
  error:           text('error'),
  ...timestamps,
});

export const clipperStatusEnum = pgEnum('clipper_status', [
  'uploading','transcribing','analyzing','cutting','captioning','done','failed',
]);

/**
 * AI Clipper job state. The pipeline runs in the worker (apps/api/src/workers/
 * clipper-worker.ts) and updates progress + intermediate artifacts here.
 */
export const clipperJobs = pgTable('clipper_jobs', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  projectId:           uuid('project_id').references(() => projects.id),
  /** 'upload' | 'youtube' | 'url' */
  sourceKind:          text('source_kind').notNull(),
  /** Asset id (for 'upload') OR external URL (for 'youtube' / 'url'). */
  sourceRef:           text('source_ref').notNull(),
  sourceDurationSec:   integer('source_duration_sec'),
  targetClipCount:     integer('target_clip_count').notNull().default(5),
  targetClipLengthSec: integer('target_clip_length_sec').notNull().default(30),
  /** 'viral' | 'subtle' | preset id */
  captionStyle:        text('caption_style').notNull().default('viral'),
  status:              clipperStatusEnum('status').notNull().default('uploading'),
  progressPct:         integer('progress_pct').notNull().default(0),
  /** Pre-LLM scene candidates: [{ start, end, energy, transcriptSnippet }] */
  candidates:          jsonb('candidates').notNull().default([]),
  /** Final clips: [{ assetId, start, end, score, reason, captions }] */
  clips:               jsonb('clips').notNull().default([]),
  error:               text('error'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
