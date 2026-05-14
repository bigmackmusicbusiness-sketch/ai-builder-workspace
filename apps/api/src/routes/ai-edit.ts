// apps/api/src/routes/ai-edit.ts — AI text-replacement on existing images.
//
// POST /api/ai-edit/text  (multipart/form-data)
//   Fields:
//     image           — PNG/JPEG of the original (required)
//     mask            — PNG binary mask (required, same dimensions)
//     replacementText — string (required, ≤ 100 chars)
//     projectId?      — uuid; when present, the new asset attaches to it
//
// Response:
//   { asset: { id, url, mimeType }, predictionId }
//
// The route fetches REPLICATE_API_TOKEN from the tenant's vault, runs
// Ideogram v2 inpainting via the provider helper, downloads the result
// into Supabase Storage as a new asset, and returns the asset record.
//
// Rate-limited at 30/min/user — Ideogram is fast but not free (~$0.08/edit).
import type { FastifyInstance } from 'fastify';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { getDb } from '../db/client';
import { assets } from '@abw/db';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { vaultGetOrEnv } from '../security/vault';
import { aiEditText } from '../providers/ideogramReplicate';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const BUCKET = 'project-assets';
function getStorage() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY).storage;
}

export async function aiEditRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Tighter rate limit on this route — each call hits a paid model.
  app.post<{ Body: unknown }>('/api/ai-edit/text', {
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
  }, async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    // Parse multipart parts
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
        parts[part.fieldname] = { buffer: buf, mimetype: part.mimetype ?? 'application/octet-stream', filename: part.filename ?? 'in.png' };
      } else if (part.type === 'field' && typeof part.value === 'string') {
        parts[part.fieldname] = part.value;
      }
    }

    const imagePart = parts['image'];
    const maskPart  = parts['mask'];
    const replacementText = typeof parts['replacementText'] === 'string' ? parts['replacementText'] : null;
    const projectId       = typeof parts['projectId'] === 'string' ? parts['projectId'] : null;

    if (!imagePart || typeof imagePart === 'string') return reply.status(400).send({ error: 'image is required' });
    if (!maskPart  || typeof maskPart  === 'string') return reply.status(400).send({ error: 'mask is required' });
    if (!replacementText) return reply.status(400).send({ error: 'replacementText is required' });
    if (replacementText.length > 100) return reply.status(400).send({ error: 'replacementText too long (max 100 chars)' });

    if (!imagePart.mimetype.startsWith('image/')) return reply.status(400).send({ error: 'image must be image/*' });
    if (!maskPart.mimetype.startsWith('image/'))  return reply.status(400).send({ error: 'mask must be image/*' });

    // Pull the Replicate token via platform-key resolution: vault first (BYOK),
    // then process.env (Coolify-level for internal-app deploys). Tenants
    // without the secret get a friendly 412 instead of a hard crash.
    const replicateToken = await vaultGetOrEnv({
      names: ['REPLICATE_API_TOKEN', 'REPLICATE_KEY', 'REPLICATE', 'replicate.api_token'],
      env: 'dev',
      tenantId: ctx.tenantId,
    });
    if (!replicateToken) {
      return reply.status(412).send({
        error: 'replicate_token_missing',
        message: 'Add REPLICATE_API_TOKEN in Settings → Secrets to enable AI text edit.',
      });
    }

    // Run the inpaint
    let result;
    try {
      result = await aiEditText({
        imageBuffer:     imagePart.buffer,
        maskBuffer:      maskPart.buffer,
        replacementText,
        replicateToken,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Defense-in-depth — even though the provider already redacts, this
      // route is the final escape hatch for whatever the agent returns.
      const safe = raw
        .replace(/r8_[A-Za-z0-9_]{20,}/g, 'r8_<redacted>')
        .replace(/Token\s+\S+/gi, 'Token <redacted>')
        .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>');
      return reply.status(502).send({ error: 'replicate_failed', message: safe });
    }

    // Download the inpainted PNG and upload to our Storage so we own the URL
    // (Replicate's hosted output URLs expire). The route returns the asset
    // record; the SPA can immediately drop it on the canvas.
    const r = await fetch(result.url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return reply.status(502).send({ error: 'fetch_replicate_output_failed', status: r.status });
    const outBuf  = Buffer.from(await r.arrayBuffer());
    const outMime = r.headers.get('content-type') ?? 'image/png';

    const storagePath = `${ctx.tenantId}/${projectId ?? 'tenant-library'}/ai-edits/${Date.now()}-edited.png`;
    const storage = getStorage();
    const { error: upErr } = await storage.from(BUCKET).upload(storagePath, outBuf, {
      contentType: outMime, upsert: false,
    });
    if (upErr) return reply.status(500).send({ error: `Storage upload failed: ${upErr.message}` });

    const publicUrl = storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;

    const db = getDb();
    const [row] = await db.insert(assets).values({
      tenantId:   ctx.tenantId,
      projectId:  projectId ?? null,
      name:       `ai-edit-${result.predictionId.slice(0, 8)}.png`,
      storagePath,
      mimeType:   outMime,
      size:       outBuf.length,
      publicUrl,
    }).returning();
    if (!row) return reply.status(500).send({ error: 'Failed to record asset' });

    return {
      asset:        { id: row.id, url: publicUrl, mimeType: outMime },
      predictionId: result.predictionId,
    };
  });
}
