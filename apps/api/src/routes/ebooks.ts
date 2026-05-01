// apps/api/src/routes/ebooks.ts — eBook generation (SSE) + export/list/delete.
// Covers the full spectrum: picture-heavy lead magnets → KDP-ready novels with covers.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, type AuthContext } from '../security/authz';
import { getDb } from '../db/client';
import { ebooks, assets } from '@abw/db';
import { eq, and, desc } from 'drizzle-orm';
import { createMinimaxAdapter } from '../providers/minimax';
import { createOllamaAdapter }  from '../providers/ollama';
import { env } from '../config/env';
import { renderHtmlToPdf } from '../lib/pdf';
import { renderEpub }       from '../lib/epub';
import { buildZip }         from '../lib/zipper';
import { uploadBufferAsAsset } from '../lib/assetUpload';
import {
  buildEbookHtml, buildEpubChapters, styleToTrim,
  type EbookRecord, type EbookStyle, type EbookChapter,
} from '../lib/ebookBuilder';
import {
  chapterDraftPrompt, chapterEditorPrompt, humanize,
  type Genre, type POV,
} from '../lib/literaryPrompts';
import { generateCoverVariants } from '../lib/coverGenerator';
import { parseManuscript, type ChapterDelimiter } from '../lib/manuscriptParser';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

// ── CORS helpers (mirrors chat.ts — needed because reply.hijack() bypasses @fastify/cors) ──
const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/.*\.pages\.dev$/,
  /^https:\/\/.*\.railway\.app$/,
];
function resolveOrigin(origin: string | undefined): string {
  if (!origin) return '*';
  return ALLOWED_ORIGINS.some((r) => r.test(origin)) ? origin : '*';
}

const EBOOK_STYLES = [
  'professional_business','lead_magnet','narrative_story','how_to_guide',
  'academic','cookbook','kdp_novel','picture_book',
] as const;

/**
 * Chapter prose generation uses M2.5 — a non-thinking model.
 * The thinking M2.7 spends most of its token budget on internal reasoning,
 * leaving no room for actual prose. M2.5 is faster, cheaper, and reliably
 * outputs the requested word count. Outline generation still uses the
 * caller's chosen model (where structured-output reasoning helps).
 */
const CHAPTER_PROSE_MODEL = 'MiniMax-M2.5';

/** Generous token budget so prose isn't truncated. */
function chapterMaxTokens(targetWords: number): number {
  // ~1.5 tokens per word + 50% headroom; clamped to model context.
  return Math.min(8192, Math.max(2000, Math.round(targetWords * 3)));
}

const GenerateBody = z.object({
  title:            z.string().min(1),
  subtitle:         z.string().optional(),
  author:           z.string().default('Anonymous'),
  topic:            z.string().optional(),
  audience:         z.string().optional(),
  tone:             z.string().optional(),
  genre:            z.enum(['literary','thriller','romance','sci_fi','fantasy','mystery','memoir','ya']).optional(),
  pov:              z.enum(['first','close_third','omniscient']).default('close_third'),
  style:            z.enum(EBOOK_STYLES),
  chapterCount:     z.number().int().min(1).max(50).default(5),
  wordCountTarget:  z.number().int().min(300).max(5000).default(800),
  generateCover:    z.boolean().default(true),
  coverGuidance:    z.string().optional(),
  projectId:        z.string().uuid().optional(),
  provider:         z.string().default('minimax'),
  model:            z.string().default('MiniMax-M2.7'),
});

// Format mode body: user provides their own manuscript; we just style + render it.
const FormatBody = z.object({
  title:            z.string().min(1),
  subtitle:         z.string().optional(),
  author:           z.string().default('Anonymous'),
  genre:            z.enum(['literary','thriller','romance','sci_fi','fantasy','mystery','memoir','ya']).optional(),
  tone:             z.string().optional(),
  style:            z.enum(EBOOK_STYLES),
  manuscript:       z.string().min(1, 'Manuscript text is required'),
  chapterDelimiter: z.enum(['heading','double_newline','triple_newline','manual']).default('heading'),
  generateCover:    z.boolean().default(true),
  coverGuidance:    z.string().optional(),
  projectId:        z.string().uuid().optional(),
  provider:         z.string().default('minimax'),
});

function stripFences(text: string): string {
  let t = text
    // Strip <think>...</think> blocks (defensive — adapter also does this for MiniMax).
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    .replace(/^```(?:json|javascript|js|)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  // If response still has prose before the JSON object, slice from the first { or [
  if (t && !t.startsWith('{') && !t.startsWith('[')) {
    const firstObj = t.search(/[{[]/);
    if (firstObj > 0) t = t.slice(firstObj);
  }
  return t;
}

async function parseJsonWithRetry<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: any,
  prompt: string,
  model: string,
  maxRetries = 1,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await adapter.complete({ prompt, model, maxTokens: 2048, temperature: 0.5 });
    const text = stripFences(String(res.text ?? ''));
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      last = err;
      if (attempt < maxRetries) {
        prompt = `${prompt}\n\nYour previous reply was not valid JSON. Return ONLY JSON, no markdown fences, no commentary.`;
      }
    }
  }
  throw new Error(`Failed to parse JSON after ${maxRetries + 1} attempts: ${String(last)}`);
}

interface Outline {
  chapters: { title: string; summary: string; targetWords?: number }[];
  frontMatter?: { copyright?: string; dedication?: string; foreword?: string };
  backMatter?:  { aboutAuthor?: string; alsoBy?: string[] };
}

function outlinePrompt(input: z.infer<typeof GenerateBody>): string {
  return [
    `You are outlining a ${input.style.replace('_', ' ')} titled "${input.title}" by ${input.author}.`,
    input.topic    ? `Topic: ${input.topic}` : '',
    input.audience ? `Audience: ${input.audience}` : '',
    input.tone     ? `Tone: ${input.tone}` : '',
    input.genre    ? `Genre: ${input.genre.replace('_', ' ')}` : '',
    ``,
    `Return ONLY JSON in exactly this shape:`,
    `{`,
    `  "chapters": [`,
    `    { "title": "string", "summary": "1-3 sentence chapter purpose", "targetWords": number }`,
    `  ],`,
    `  "frontMatter": { "copyright": "string", "dedication": "string", "foreword": "string" },`,
    `  "backMatter":  { "aboutAuthor": "string", "alsoBy": ["string"] }`,
    `}`,
    ``,
    `Produce exactly ${input.chapterCount} chapters.`,
    `Target word count per chapter: ${input.wordCountTarget}.`,
    `Front matter and back matter are optional for non-fiction but REQUIRED for the kdp_novel and narrative_story styles.`,
    `No markdown, no commentary — JSON only.`,
  ].filter(Boolean).join('\n');
}

export async function ebooksRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── List ─────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { projectId?: string } }>('/api/ebooks', async (req) => {
    const ctx = req.authCtx!;
    const db  = getDb();
    const where = req.query.projectId
      ? and(eq(ebooks.tenantId, ctx.tenantId), eq(ebooks.projectId, req.query.projectId))
      : eq(ebooks.tenantId, ctx.tenantId);
    const rows = await db.select().from(ebooks).where(where).orderBy(desc(ebooks.createdAt)).limit(200);
    return { ebooks: rows };
  });

  // ── Delete ───────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/ebooks/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db  = getDb();
    await db.delete(ebooks)
      .where(and(eq(ebooks.id, req.params.id), eq(ebooks.tenantId, ctx.tenantId)));
    return reply.status(204).send();
  });

  // ── Download (redirect) ──────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/api/ebooks/:id/download',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const db  = getDb();
      const [row] = await db.select().from(ebooks)
        .where(and(eq(ebooks.id, req.params.id), eq(ebooks.tenantId, ctx.tenantId)));
      if (!row) return reply.status(404).send({ error: 'eBook not found' });

      const format = req.query.format ?? 'pdf';
      const assetId = format === 'epub' ? row.epubAssetId
                    : format === 'kdp'  ? row.kdpBundleAssetId
                    :                     row.pdfAssetId;
      if (!assetId) return reply.status(404).send({ error: `No ${format} asset for this eBook` });

      const [a] = await db.select().from(assets).where(eq(assets.id, assetId));
      if (!a?.publicUrl) return reply.status(404).send({ error: 'Asset URL missing' });
      return reply.redirect(a.publicUrl);
    },
  );

  // ── Generate (SSE) ───────────────────────────────────────────────────────
  // OPTIONS preflight — needed because reply.hijack() bypasses @fastify/cors
  app.options('/api/ebooks/generate', async (req, reply) => {
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    return reply
      .header('Access-Control-Allow-Origin',  origin)
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Max-Age',       '86400')
      .header('Vary',                         'Origin')
      .status(204).send();
  });

  app.post<{ Body: unknown }>('/api/ebooks/generate', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }
    const body = parsed.data;

    // SSE setup
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    reply.hijack();
    const raw = reply.raw;
    raw.setHeader('Access-Control-Allow-Origin',      origin);
    raw.setHeader('Access-Control-Allow-Credentials', 'true');
    raw.setHeader('Vary',                             'Origin');
    raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no');
    raw.flushHeaders?.();
    const send = (obj: unknown) => raw.write(`data: ${JSON.stringify(obj)}\n\n`);

    const controller = new AbortController();
    req.raw.once('close', () => controller.abort());

    // Adapter
    const adapter = body.provider === 'ollama'
      ? createOllamaAdapter(env.OLLAMA_BASE_URL)
      : createMinimaxAdapter(ctx.tenantId, 'dev');

    // Insert row (status=generating)
    const db = getDb();
    const [row] = await db.insert(ebooks).values({
      tenantId:        ctx.tenantId,
      projectId:       body.projectId ?? null,
      title:           body.title,
      topic:           body.topic,
      audience:        body.audience,
      tone:            body.tone,
      genre:           body.genre,
      pov:             body.pov,
      style:           body.style as EbookStyle,
      chapterCount:    body.chapterCount,
      wordCountTarget: body.wordCountTarget,
      status:          'generating',
    }).returning();
    if (!row) { send({ type: 'error', error: 'Failed to create eBook row' }); raw.end(); return; }

    send({ type: 'created', ebookId: row.id });

    try {
      // ── Step 1: outline ────────────────────────────────────────────────
      send({ type: 'step', step: 'outline' });
      const outline = await parseJsonWithRetry<Outline>(adapter, outlinePrompt(body), body.model);
      if (!Array.isArray(outline.chapters) || outline.chapters.length === 0) {
        throw new Error('Outline missing chapters array');
      }

      await db.update(ebooks).set({ outline: outline as unknown as object, updatedAt: new Date() }).where(eq(ebooks.id, row.id));
      send({ type: 'outline', chapters: outline.chapters.map((c) => c.title) });

      // ── Step 2: draft + editor pass per chapter ────────────────────────
      const isNovel = body.style === 'kdp_novel' || body.style === 'narrative_story';
      const chapters: EbookChapter[] = [];
      let prevSummary: string | undefined;

      for (let i = 0; i < outline.chapters.length; i++) {
        if (controller.signal.aborted) throw new Error('Cancelled by client');
        const oc = outline.chapters[i]!;
        send({ type: 'step', step: 'chapter', index: i, title: oc.title });

        const promptInput = {
          bookTitle:      body.title,
          genre:          (body.genre ?? 'literary') as Genre,
          pov:            body.pov as POV,
          tone:           body.tone,
          audience:       body.audience,
          chapterNumber:  i + 1,
          chapterTitle:   oc.title,
          chapterSummary: oc.summary,
          targetWords:    oc.targetWords ?? body.wordCountTarget,
          previousSummary: prevSummary,
        };

        // Use the non-thinking M2.5 for prose to avoid `<think>` eating the token budget.
        // (See CHAPTER_PROSE_MODEL comment.)
        const targetW = oc.targetWords ?? body.wordCountTarget;
        const draft = await adapter.complete({
          prompt: chapterDraftPrompt(promptInput),
          model:  CHAPTER_PROSE_MODEL,
          maxTokens:   chapterMaxTokens(targetW),
          temperature: 0.85,
        });

        let prose = draft.text ?? '';

        if (isNovel) {
          send({ type: 'step', step: 'edit', index: i });
          const edited = await adapter.complete({
            prompt: chapterEditorPrompt(prose, promptInput),
            model:  CHAPTER_PROSE_MODEL,
            maxTokens:   chapterMaxTokens(targetW),
            temperature: 0.55,
          });
          prose = edited.text ?? prose;
        }

        // Defensive: if the model still returned nothing, fall back to the
        // chapter summary so the book has *something* readable per chapter
        // rather than blank pages. Surface a warning to the user.
        if (!prose.trim()) {
          send({ type: 'warn', message: `Chapter ${i + 1} returned empty prose; using summary as fallback.` });
          prose = oc.summary || `[Chapter ${i + 1} content could not be generated.]`;
        }

        prose = humanize(prose);
        chapters.push({ title: oc.title, summary: oc.summary, prose });
        prevSummary = oc.summary;

        // Persist progress to DB so UI can resume on reconnect
        const partialOutline = { ...outline, chapters: outline.chapters.map((c, j) => ({
          ...c,
          prose: j <= i ? chapters[j]?.prose : undefined,
        })) };
        await db.update(ebooks).set({ outline: partialOutline as unknown as object, updatedAt: new Date() }).where(eq(ebooks.id, row.id));
      }

      // ── Step 3: cover (optional) ───────────────────────────────────────
      let coverUrl: string | undefined;
      let coverAssetId: string | undefined;
      const coverVariantAssetIds: string[] = [];
      if (body.generateCover && adapter.generateImage) {
        send({ type: 'step', step: 'cover' });
        try {
          const variants = await generateCoverVariants(
            adapter,
            {
              title:    body.title,
              subtitle: body.subtitle,
              author:   body.author,
              genre:    body.genre,
              tone:     body.tone,
              userGuidance: body.coverGuidance,
            },
            3,
            controller.signal,
          );
          for (let i = 0; i < variants.length; i++) {
            const up = await uploadBufferAsAsset({
              tenantId:  ctx.tenantId,
              projectId: body.projectId ?? null,
              folder:    `ebooks/${row.id}/cover-variants`,
              filename:  `cover-${i + 1}.png`,
              mimeType:  'image/jpeg',
              buffer:    variants[i]!.imageBuf,
            });
            coverVariantAssetIds.push(up.assetId);
            if (i === 0) {
              coverUrl = up.url;
              coverAssetId = up.assetId;
            }
          }
        } catch (err) {
          send({ type: 'warn', message: `Cover generation failed: ${String(err)}` });
        }
      }

      // ── Step 4: build HTML → PDF ───────────────────────────────────────
      send({ type: 'step', step: 'pdf' });
      const record: EbookRecord = {
        title:       body.title,
        subtitle:    body.subtitle,
        author:      body.author,
        style:       body.style as EbookStyle,
        genre:       body.genre,
        chapters,
        coverUrl,
        frontMatter: outline.frontMatter,
        backMatter:  outline.backMatter,
      };

      const html = buildEbookHtml(record);
      const pdfBuf = await renderHtmlToPdf({ html, format: styleToTrim(body.style as EbookStyle) });

      const pdfUpload = await uploadBufferAsAsset({
        tenantId:  ctx.tenantId,
        projectId: body.projectId ?? null,
        folder:    `ebooks/${row.id}`,
        filename:  `${slug(body.title)}.pdf`,
        mimeType:  'application/pdf',
        buffer:    pdfBuf,
      });

      // ── Step 5: EPUB (novels + most styles) ────────────────────────────
      let epubAssetId: string | undefined;
      if (body.style !== 'picture_book') {
        send({ type: 'step', step: 'epub' });
        try {
          const epubBuf = await renderEpub({
            title:   body.title,
            author:  body.author,
            description: body.topic ?? body.subtitle,
            coverUrl,
            chapters: buildEpubChapters(record),
          });
          const epubUpload = await uploadBufferAsAsset({
            tenantId:  ctx.tenantId,
            projectId: body.projectId ?? null,
            folder:    `ebooks/${row.id}`,
            filename:  `${slug(body.title)}.epub`,
            mimeType:  'application/epub+zip',
            buffer:    epubBuf,
          });
          epubAssetId = epubUpload.assetId;
        } catch (err) {
          send({ type: 'warn', message: `EPUB generation failed: ${String(err)}` });
        }
      }

      // ── Step 6: KDP bundle ZIP (novels only) ───────────────────────────
      let kdpBundleAssetId: string | undefined;
      if (body.style === 'kdp_novel') {
        send({ type: 'step', step: 'kdp_bundle' });
        try {
          const metadata = {
            title: body.title,
            subtitle: body.subtitle,
            author: body.author,
            genre: body.genre,
            description: outline.frontMatter?.foreword ?? body.topic ?? '',
            keywords: [body.genre, body.style, body.tone].filter(Boolean),
          };
          const zipBuf = await buildZip([
            { path: 'interior.pdf', content: pdfBuf },
            { path: 'metadata.json', content: JSON.stringify(metadata, null, 2) },
            ...(coverAssetId ? [{ path: 'cover.jpg', content: Buffer.from('') }] : []),
          ]);
          const up = await uploadBufferAsAsset({
            tenantId:  ctx.tenantId,
            projectId: body.projectId ?? null,
            folder:    `ebooks/${row.id}`,
            filename:  `${slug(body.title)}-kdp.zip`,
            mimeType:  'application/zip',
            buffer:    zipBuf,
          });
          kdpBundleAssetId = up.assetId;
        } catch (err) {
          send({ type: 'warn', message: `KDP bundle failed: ${String(err)}` });
        }
      }

      // ── Finalize ────────────────────────────────────────────────────────
      await db.update(ebooks).set({
        status:           'ready',
        pdfAssetId:       pdfUpload.assetId,
        ...(epubAssetId      ? { epubAssetId }      : {}),
        ...(coverAssetId     ? { coverAssetId }     : {}),
        ...(kdpBundleAssetId ? { kdpBundleAssetId } : {}),
        coverVariants:    coverVariantAssetIds as unknown as object,
        updatedAt:        new Date(),
      }).where(eq(ebooks.id, row.id));

      send({
        type: 'done',
        ebookId: row.id,
        pdfAssetId: pdfUpload.assetId,
        epubAssetId,
        coverAssetId,
        kdpBundleAssetId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(ebooks).set({ status: 'failed', error: msg, updatedAt: new Date() }).where(eq(ebooks.id, row.id));
      send({ type: 'error', error: msg });
    } finally {
      raw.end();
    }

    return undefined;
  });

  // ── Format mode (SSE): user provides manuscript; we just style + render ────
  // OPTIONS preflight (reply.hijack() bypasses @fastify/cors, same as /generate)
  app.options('/api/ebooks/format', async (req, reply) => {
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    return reply
      .header('Access-Control-Allow-Origin',  origin)
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Max-Age',       '86400')
      .header('Vary',                         'Origin')
      .status(204).send();
  });

  app.post<{ Body: unknown }>('/api/ebooks/format', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = FormatBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }
    const body = parsed.data;

    // SSE setup (mirrors /generate)
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    reply.hijack();
    const raw = reply.raw;
    raw.setHeader('Access-Control-Allow-Origin',      origin);
    raw.setHeader('Access-Control-Allow-Credentials', 'true');
    raw.setHeader('Vary',                             'Origin');
    raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no');
    raw.flushHeaders?.();
    const send = (obj: unknown) => raw.write(`data: ${JSON.stringify(obj)}\n\n`);

    const controller = new AbortController();
    req.raw.once('close', () => controller.abort());

    // Insert row (mode='format', rawManuscript stored for re-edit later)
    const db = getDb();
    const [row] = await db.insert(ebooks).values({
      tenantId:        ctx.tenantId,
      projectId:       body.projectId ?? null,
      title:           body.title,
      genre:           body.genre,
      tone:            body.tone,
      style:           body.style as EbookStyle,
      mode:            'format',
      rawManuscript:   body.manuscript,
      // chapterCount + wordCountTarget aren't really meaningful for format mode,
      // but the columns are NOT NULL, so leave defaults.
      status:          'generating',
    }).returning();
    if (!row) { send({ type: 'error', error: 'Failed to create eBook row' }); raw.end(); return; }

    send({ type: 'created', ebookId: row.id });

    try {
      // ── Step 1: parse manuscript into chapters ─────────────────────────
      send({ type: 'step', step: 'parsing' });
      const chapters: EbookChapter[] = parseManuscript(
        body.manuscript,
        body.chapterDelimiter as ChapterDelimiter,
      );
      if (chapters.length === 0) {
        throw new Error('Manuscript could not be parsed into any chapters. Try a different chapter delimiter.');
      }
      send({ type: 'parsed', chapterCount: chapters.length, chapters: chapters.map((c) => c.title) });

      // Persist parsed structure to outline JSONB so UI/library can show it
      const outline = {
        chapters: chapters.map((c) => ({ title: c.title, summary: c.summary ?? '', prose: c.prose })),
      };
      await db.update(ebooks).set({
        outline:      outline as unknown as object,
        chapterCount: chapters.length,
        updatedAt:    new Date(),
      }).where(eq(ebooks.id, row.id));

      // ── Step 2: cover (optional) ───────────────────────────────────────
      let coverUrl: string | undefined;
      let coverAssetId: string | undefined;
      const coverVariantAssetIds: string[] = [];
      if (body.generateCover) {
        send({ type: 'step', step: 'cover' });
        try {
          const adapter = body.provider === 'ollama'
            ? createOllamaAdapter(env.OLLAMA_BASE_URL)
            : createMinimaxAdapter(ctx.tenantId, 'dev');
          if (adapter.generateImage) {
            const variants = await generateCoverVariants(
              adapter,
              {
                title:    body.title,
                subtitle: body.subtitle,
                author:   body.author,
                genre:    body.genre,
                tone:     body.tone,
                userGuidance: body.coverGuidance,
              },
              3,
              controller.signal,
            );
            for (let i = 0; i < variants.length; i++) {
              const up = await uploadBufferAsAsset({
                tenantId:  ctx.tenantId,
                projectId: body.projectId ?? null,
                folder:    `ebooks/${row.id}/cover-variants`,
                filename:  `cover-${i + 1}.png`,
                mimeType:  'image/jpeg',
                buffer:    variants[i]!.imageBuf,
              });
              coverVariantAssetIds.push(up.assetId);
              if (i === 0) {
                coverUrl     = up.url;
                coverAssetId = up.assetId;
              }
            }
          }
        } catch (err) {
          send({ type: 'warn', message: `Cover generation failed: ${String(err)}` });
        }
      }

      // ── Step 3: build HTML → PDF ───────────────────────────────────────
      send({ type: 'step', step: 'pdf' });
      const record: EbookRecord = {
        title:    body.title,
        subtitle: body.subtitle,
        author:   body.author,
        style:    body.style as EbookStyle,
        genre:    body.genre,
        chapters,
        coverUrl,
      };
      const html = buildEbookHtml(record);
      const pdfBuf = await renderHtmlToPdf({ html, format: styleToTrim(body.style as EbookStyle) });

      const pdfUpload = await uploadBufferAsAsset({
        tenantId:  ctx.tenantId,
        projectId: body.projectId ?? null,
        folder:    `ebooks/${row.id}`,
        filename:  `${slug(body.title)}.pdf`,
        mimeType:  'application/pdf',
        buffer:    pdfBuf,
      });

      // ── Step 4: EPUB (skip for picture_book) ───────────────────────────
      let epubAssetId: string | undefined;
      if (body.style !== 'picture_book') {
        send({ type: 'step', step: 'epub' });
        try {
          const epubBuf = await renderEpub({
            title:       body.title,
            author:      body.author,
            description: body.subtitle,
            coverUrl,
            chapters: buildEpubChapters(record),
          });
          const epubUpload = await uploadBufferAsAsset({
            tenantId:  ctx.tenantId,
            projectId: body.projectId ?? null,
            folder:    `ebooks/${row.id}`,
            filename:  `${slug(body.title)}.epub`,
            mimeType:  'application/epub+zip',
            buffer:    epubBuf,
          });
          epubAssetId = epubUpload.assetId;
        } catch (err) {
          send({ type: 'warn', message: `EPUB generation failed: ${String(err)}` });
        }
      }

      // ── Finalize ────────────────────────────────────────────────────────
      await db.update(ebooks).set({
        status:        'ready',
        pdfAssetId:    pdfUpload.assetId,
        ...(epubAssetId  ? { epubAssetId }  : {}),
        ...(coverAssetId ? { coverAssetId } : {}),
        coverVariants: coverVariantAssetIds as unknown as object,
        updatedAt:     new Date(),
      }).where(eq(ebooks.id, row.id));

      send({
        type: 'done',
        ebookId: row.id,
        pdfAssetId: pdfUpload.assetId,
        epubAssetId,
        coverAssetId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(ebooks).set({ status: 'failed', error: msg, updatedAt: new Date() }).where(eq(ebooks.id, row.id));
      send({ type: 'error', error: msg });
    } finally {
      raw.end();
    }

    return undefined;
  });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'ebook';
}
