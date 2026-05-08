// apps/api/src/routes/ads.ts — Ads Studio CRUD + render orchestration.
//
// Surface:
//   GET    /api/ads?projectId=&kind=        list creatives (tenant-scoped)
//   POST   /api/ads                         create new draft (validates char limits)
//   PATCH  /api/ads/:id                     update copy/layers
//   GET    /api/ads/seed?niche=&framework=  copy seeds for the framework picker
//   POST   /api/ads/:id/render              run slop blocker → upload rendered blob
//                                           → save as asset → set assetId →
//                                           generate 2 A/B variants
//   DELETE /api/ads/:id                     soft-delete
//
// The actual canvas-to-PNG / canvas-to-MP4 rendering happens in the SPA;
// this route receives the rendered binary via multipart upload. That avoids
// adding `sharp` as a server-side native dep — the agent already runs sharp
// on dedicated rendering paths (preview screenshot via Playwright, video
// edit via ffmpeg) so we keep ads on the same client-server split.
//
// The slop blocker, char-limit warnings, and A/B variant generation are
// server-side because they're trust boundaries — a buggy SPA can't bypass
// the quality gate.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { getDb } from '../db/client';
import { adCreatives, assets, projects } from '@abw/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { checkAdCopyForSlop } from './ads/slopBlocker';
import { checkCharLimits, META_CHAR_LIMITS, type Placement } from './ads/charLimits';
import { generateVariants, patternForFramework, patternsForNiche, type FrameworkId } from './ads/copyPatterns';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const BUCKET = 'project-assets';

function getStorage() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY).storage;
}

const KindEnum      = z.enum(['image', 'video', 'carousel']);
const PlacementEnum = z.enum(['feed', 'stories', 'reels', 'marketplace']);
const AspectEnum    = z.enum(['1:1', '4:5', '9:16']);

const CreateBodySchema = z.object({
  projectId:    z.string().uuid().nullable().optional(),
  kind:         KindEnum,
  placement:    PlacementEnum.default('feed'),
  aspectRatio:  AspectEnum,
  headline:     z.string().default(''),
  primaryText:  z.string().default(''),
  description:  z.string().default(''),
  callToAction: z.string().default('Learn More'),
  /** Optional niche hint — used to seed copy when creating a new ad. */
  niche:        z.string().optional(),
  /** Optional framework hint — when present, seed copy from that framework. */
  framework:    z.enum(['specific-value-prop', 'pattern-interrupt', 'before-after']).optional(),
  /** Carousel only — array of card objects. */
  cards:        z.array(z.object({
    headline:    z.string().default(''),
    description: z.string().default(''),
    assetId:     z.string().uuid().optional(),
    primaryText: z.string().optional(),
  })).optional(),
});

const UpdateBodySchema = CreateBodySchema.partial();

const ListQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  kind:      KindEnum.optional(),
});

export async function adsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── List ───────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { projectId?: string; kind?: string } }>('/api/ads', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query' });

    const db = getDb();
    const where = and(
      eq(adCreatives.tenantId, ctx.tenantId),
      // Filter out soft-deleted rows — DELETE /api/ads/:id sets deletedAt
      // rather than dropping the row, so the list must explicitly exclude
      // them or the Library would keep showing tombstones.
      isNull(adCreatives.deletedAt),
      ...(parsed.data.projectId ? [eq(adCreatives.projectId, parsed.data.projectId)] : []),
      ...(parsed.data.kind ? [eq(adCreatives.kind, parsed.data.kind)] : []),
    );

    const rows = await db
      .select({
        id:           adCreatives.id,
        projectId:    adCreatives.projectId,
        kind:         adCreatives.kind,
        placement:    adCreatives.placement,
        aspectRatio:  adCreatives.aspectRatio,
        headline:     adCreatives.headline,
        primaryText:  adCreatives.primaryText,
        description:  adCreatives.description,
        callToAction: adCreatives.callToAction,
        assetId:      adCreatives.assetId,
        extra:        adCreatives.extra,
        createdAt:    adCreatives.createdAt,
        updatedAt:    adCreatives.updatedAt,
        // Pull asset URL for thumbnail rendering in the Library
        assetUrl:     assets.publicUrl,
        assetMime:    assets.mimeType,
        projectName:  projects.name,
      })
      .from(adCreatives)
      .leftJoin(assets,   eq(assets.id, adCreatives.assetId))
      .leftJoin(projects, eq(projects.id, adCreatives.projectId))
      .where(where)
      .orderBy(desc(adCreatives.updatedAt));

    return { ads: rows };
  });

  // ── Copy seeds (for the framework-picker UI) ─────────────────────────────
  /**
   * GET /api/ads/seed?niche=specialty-cafe&framework=specific-value-prop
   *
   *  Returns one starter pattern (headline + primaryText) for the niche +
   *  framework combo. When framework is omitted, returns the full set so
   *  the SPA can preview all three angles before the user picks.
   */
  app.get<{ Querystring: { niche?: string; framework?: string } }>('/api/ads/seed', async (req, reply) => {
    const niche = req.query.niche;
    const framework = req.query.framework as FrameworkId | undefined;
    if (framework && !['specific-value-prop', 'pattern-interrupt', 'before-after'].includes(framework)) {
      return reply.status(400).send({ error: 'Invalid framework' });
    }
    if (framework) {
      return { pattern: patternForFramework(niche, framework) };
    }
    return { patterns: patternsForNiche(niche) };
  });

  // ── Create ─────────────────────────────────────────────────────────────────
  app.post<{ Body: unknown }>('/api/ads', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');
    const parsed = CreateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }

    let { headline, primaryText } = parsed.data;
    const { projectId, kind, placement, aspectRatio, description, callToAction, niche, framework, cards } = parsed.data;

    // Seed copy from the niche+framework if the user didn't supply any.
    // Lets the "click Specific value prop" button on the framework picker
    // immediately fill the headline + primary text fields server-driven —
    // single source of truth for the patterns.
    if (framework && !headline && !primaryText) {
      const seed = patternForFramework(niche, framework);
      headline    = seed.headline;
      primaryText = seed.primary;
    }

    const warnings = checkCharLimits({ placement, headline, primaryText, description });

    const db = getDb();
    const [row] = await db.insert(adCreatives).values({
      tenantId:     ctx.tenantId,
      projectId:    projectId ?? null,
      kind,
      placement,
      aspectRatio,
      headline,
      primaryText,
      description,
      callToAction,
      extra: kind === 'carousel' ? { cards: cards ?? [] } : {},
    }).returning();
    if (!row) return reply.status(500).send({ error: 'Failed to create' });

    return reply.status(201).send({ ad: row, warnings });
  });

  // ── Update ─────────────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/ads/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');
    const parsed = UpdateBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const db = getDb();
    const [existing] = await db.select().from(adCreatives)
      .where(and(
        eq(adCreatives.id, req.params.id),
        eq(adCreatives.tenantId, ctx.tenantId),
        isNull(adCreatives.deletedAt),
      ));
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    const next = {
      ...(parsed.data.placement    && { placement: parsed.data.placement }),
      ...(parsed.data.aspectRatio  && { aspectRatio: parsed.data.aspectRatio }),
      ...(parsed.data.headline     !== undefined && { headline: parsed.data.headline }),
      ...(parsed.data.primaryText  !== undefined && { primaryText: parsed.data.primaryText }),
      ...(parsed.data.description  !== undefined && { description: parsed.data.description }),
      ...(parsed.data.callToAction !== undefined && { callToAction: parsed.data.callToAction }),
      ...(parsed.data.cards        && { extra: { ...((existing.extra as Record<string, unknown>) ?? {}), cards: parsed.data.cards } }),
      updatedAt: new Date(),
    };

    const [row] = await db.update(adCreatives).set(next)
      .where(eq(adCreatives.id, req.params.id)).returning();

    const warnings = checkCharLimits({
      placement:   row?.placement ?? existing.placement,
      headline:    row?.headline ?? existing.headline,
      primaryText: row?.primaryText ?? existing.primaryText,
      description: row?.description ?? existing.description,
    });
    return { ad: row, warnings };
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  /**
   * POST /api/ads/:id/render  (multipart/form-data)
   *
   *  Fields:
   *    file        — the rendered PNG (image/carousel) or MP4 (video). Required.
   *    force?      — string '1' to bypass the slop blocker after the user
   *                  acknowledged the warning in the UI.
   *
   *  Server runs the slop blocker against the saved copy, refuses the
   *  upload with 422 + slopFlags if any phrase matches and force != '1'.
   *  Otherwise:
   *    1. Uploads the file to Supabase Storage (project-assets bucket)
   *    2. Inserts an assets row with the public URL
   *    3. Sets adCreatives.asset_id = new asset id
   *    4. Generates 2 copy variants from the framework picker, returns
   *       them so the SPA can stash them as siblings in the Library.
   */
  app.post<{ Params: { id: string } }>('/api/ads/:id/render', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const db = getDb();
    const [ad] = await db.select().from(adCreatives)
      .where(and(
        eq(adCreatives.id, req.params.id),
        eq(adCreatives.tenantId, ctx.tenantId),
        isNull(adCreatives.deletedAt),
      ));
    if (!ad) return reply.status(404).send({ error: 'Not found' });

    // ── Slop blocker ─────────────────────────────────────────────────────
    // Only check the kind we know carries copy fields. Carousel cards are
    // checked individually via the `extra.cards` array.
    const slop = checkAdCopyForSlop({
      headline:     ad.headline,
      primaryText:  ad.primaryText,
      description:  ad.description,
      callToAction: ad.callToAction,
    });

    // Check carousel cards too
    const carouselCards = ad.kind === 'carousel'
      ? ((ad.extra as { cards?: Array<{ headline?: string; description?: string }> })?.cards ?? [])
      : [];
    const cardSlops = carouselCards.map((c) => checkAdCopyForSlop({
      headline:    c.headline,
      description: c.description,
    }));
    const anyCardSlop = cardSlops.some((s) => !s.ok);

    // ── Parse multipart for force flag + file ────────────────────────────
    const parts: Record<string, string | { buffer: Buffer; mimetype: string; filename: string }> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const part of (req as any).parts() as AsyncIterable<{
      type: 'file' | 'field';
      fieldname: string;
      mimetype?: string;
      filename?: string;
      value?: string;
      toBuffer?: () => Promise<Buffer>;
    }>) {
      if (part.type === 'file' && part.toBuffer) {
        const buf = await part.toBuffer();
        parts[part.fieldname] = { buffer: buf, mimetype: part.mimetype ?? 'application/octet-stream', filename: part.filename ?? 'render.bin' };
      } else if (part.type === 'field' && typeof part.value === 'string') {
        parts[part.fieldname] = part.value;
      }
    }

    const force = parts['force'] === '1';

    if ((!slop.ok || anyCardSlop) && !force) {
      return reply.status(422).send({
        error:     'slop_detected',
        slopFlags: slop.matches,
        cardFlags: cardSlops.map((s, i) => ({ index: i, ...s })),
        summary:   slop.summary,
      });
    }

    const filePart = parts['file'];
    if (!filePart || typeof filePart === 'string') {
      return reply.status(400).send({ error: 'file is required (multipart field "file")' });
    }

    // Sanity: image/carousel must be image/*; video must be video/*
    const expectClass = ad.kind === 'video' ? 'video/' : 'image/';
    if (!filePart.mimetype.startsWith(expectClass)) {
      return reply.status(400).send({ error: `Expected ${expectClass}* for kind=${ad.kind}, got ${filePart.mimetype}` });
    }

    // ── Storage upload ────────────────────────────────────────────────────
    const safeName    = (filePart.filename || `ad-${ad.id}.${ad.kind === 'video' ? 'mp4' : 'png'}`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${ctx.tenantId}/${ad.projectId ?? 'tenant-library'}/ads/${Date.now()}-${safeName}`;
    const storage = getStorage();
    const { error: upErr } = await storage.from(BUCKET).upload(storagePath, filePart.buffer, {
      contentType: filePart.mimetype, upsert: false,
    });
    if (upErr) return reply.status(500).send({ error: `Storage upload failed: ${upErr.message}` });
    const publicUrl = storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;

    // ── Save asset record ─────────────────────────────────────────────────
    const [assetRow] = await db.insert(assets).values({
      tenantId:    ctx.tenantId,
      projectId:   ad.projectId ?? null,
      name:        safeName,
      storagePath,
      mimeType:    filePart.mimetype,
      size:        filePart.buffer.length,
      publicUrl,
    }).returning();
    if (!assetRow) return reply.status(500).send({ error: 'Failed to create asset record' });

    // ── Link to creative ──────────────────────────────────────────────────
    const [updated] = await db.update(adCreatives)
      .set({ assetId: assetRow.id, updatedAt: new Date() })
      .where(eq(adCreatives.id, ad.id))
      .returning();

    // ── A/B variants ──────────────────────────────────────────────────────
    // Pick the framework that best matches the existing primary text by
    // looking at which seed it most resembles — but to keep this trivial,
    // just rotate through the other two frameworks. Server returns the
    // copy; the SPA composites + uploads each variant the same way.
    const niche = await detectNicheFromProject(ad.projectId, ctx.tenantId);
    const variantPatterns = generateVariants(niche, {
      framework: 'specific-value-prop',  // assumed — variants pick the OTHER two
      headline:  ad.headline,
      primary:   ad.primaryText,
    });

    return {
      ad:       updated,
      asset:    { id: assetRow.id, url: publicUrl, mimeType: filePart.mimetype },
      variants: variantPatterns,
      warnings: checkCharLimits({
        placement:   ad.placement,
        headline:    ad.headline,
        primaryText: ad.primaryText,
        description: ad.description,
      }),
      forced:   force,
      slop:     slop.matches.length > 0 ? slop.matches : undefined,
    };
  });

  // ── Char-limit table for the SPA ─────────────────────────────────────────
  app.get('/api/ads/limits', async () => ({ limits: META_CHAR_LIMITS }));

  // ── Delete (soft) ──────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/ads/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');
    const db = getDb();
    const [row] = await db.update(adCreatives)
      .set({ deletedAt: new Date() })
      .where(and(eq(adCreatives.id, req.params.id), eq(adCreatives.tenantId, ctx.tenantId)))
      .returning();
    if (!row) return reply.status(404).send({ error: 'Not found' });
    return reply.status(204).send();
  });
}

/** Best-effort niche lookup. Returns the niche stored in the project's
 *  `config.niche` jsonb field if the planner phase wrote one. Most
 *  projects won't have it; undefined is the expected fallback and the
 *  copy-pattern module handles that case gracefully. */
async function detectNicheFromProject(
  projectId: string | null,
  tenantId:  string,
): Promise<string | undefined> {
  if (!projectId) return undefined;
  const db = getDb();
  const [row] = await db.select({ config: projects.config })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
  const config = (row?.config as { niche?: string } | undefined) ?? undefined;
  return config?.niche;
}

// Charlimits placement type re-exported for future imports
export type { Placement };
