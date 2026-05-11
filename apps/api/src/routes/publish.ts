// apps/api/src/routes/publish.ts — publish target CRUD + deploy endpoint.
// Manages Cloudflare Pages publish targets and records deployment history.
// Production deploys are approval-gated server-side.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { publishTargets, deployments } from '@abw/db';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { writeAuditEvent } from '../security/audit';
import { bundleProject } from '../preview/bundler';
import { deployToCFPages } from '@abw/publish';
import { getWorkspace, workspaceExists, restoreWorkspaceFromStorage } from '../preview/workspace';
import { stat } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { env as appEnv } from '../config/env';
import { resolveSignalpointConfigForProject, serializeSignalpointConfig } from '../security/signalpointConfig';
import { getRawSql } from '../db/client';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const CreateTargetSchema = z.object({
  projectId: z.string().uuid(),
  name:      z.string().min(1).max(120),
  /** 'cloudflare-pages' | 'static-export' | 'supabase' */
  provider:  z.enum(['cloudflare-pages', 'static-export', 'supabase']),
  env:       z.enum(['preview', 'production']),
  /** Optional: custom Pages URL or bucket name */
  url:       z.string().url().optional(),
  /** CF Account ID — stored in config, not a secret */
  accountId: z.string().optional(),
  /** Name of the CF Pages project (defaults to projectSlug) */
  pagesProject: z.string().optional(),
});

const DeploySchema = z.object({
  targetId:    z.string().uuid(),
  projectId:   z.string().uuid(),
  projectSlug: z.string().regex(/^[a-z0-9-]+$/),
  rootDir:     z.string().min(1).default('/tmp/abw-deploy'),
  entryPoint:  z.string().default('src/main.tsx'),
  framework:   z.enum(['react-vite', 'vanilla', 'static']).default('react-vite'),
  commitMsg:   z.string().max(250).optional(),
  /** Optional: when present, attach the static-export deploy to this
   *  Cloudflare-managed hostname. Backend creates a CNAME in the user's
   *  CF zone pointing to the api origin. The customHost route then
   *  serves the deploy when traffic arrives with this Host header. */
  customDomain: z.string()
    .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/i, 'Must be a fully-qualified domain like halcyonestates.com or www.halcyonestates.com')
    .max(253)
    .optional(),
  /** CF Zone ID where the CNAME should be created. Required iff customDomain
   *  is set — the picker UI knows this from the /api/cf/zones response so
   *  the backend doesn't have to look it up again. */
  cfZoneId:     z.string().regex(/^[a-z0-9]{32}$/i).optional(),
});

const ListDeploymentsSchema = z.object({
  projectId: z.string().uuid(),
  limit:     z.coerce.number().int().min(1).max(100).default(50),
});

// ── Route plugin ───────────────────────────────────────────────────────────────

export async function publishRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/publish/targets?projectId= ─────────────────────────────────────
  app.get<{ Querystring: { projectId?: string } }>(
    '/api/publish/targets',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const projectId = req.query.projectId;
      if (!projectId) return reply.status(400).send({ error: 'projectId required' });

      const db = getDb();
      const rows = await db
        .select()
        .from(publishTargets)
        .where(
          and(
            eq(publishTargets.projectId, projectId),
            eq(publishTargets.tenantId, ctx.tenantId),
          ),
        )
        .orderBy(publishTargets.createdAt);

      // Map DB field 'adapter' → UI field 'provider'; add connected flag
      const targets = rows.map((r) => ({
        id:         r.id,
        name:       r.name,
        provider:   r.adapter,          // adapter == provider in UI terms
        env:        r.env,
        connected:  true,               // if it's in the DB it's connected
        url:        r.lastDeployUrl ?? undefined,
        lastDeploy: r.lastDeployAt?.toISOString() ?? undefined,
        // Surface the bound custom domain on the picker / target card
        customDomain: ((r.config as Record<string, unknown> | null)?.['customDomain'] as string | undefined) ?? undefined,
        config:     r.config,
      }));

      return { targets };
    },
  );

  // ── POST /api/publish/targets ────────────────────────────────────────────────
  app.post<{ Body: unknown }>('/api/publish/targets', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = CreateTargetSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }
    const { projectId, name, provider, env, url, accountId, pagesProject } = parsed.data;

    const db = getDb();
    const [row] = await db.insert(publishTargets).values({
      projectId,
      tenantId:  ctx.tenantId,
      name,
      adapter:   provider,       // DB stores as 'adapter'
      env,
      config: {
        url:          url          ?? null,
        accountId:    accountId   ?? null,
        pagesProject: pagesProject ?? null,
      },
    }).returning();

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'publish.target.create', target: 'publish_targets', targetId: row?.id,
      after: { name, provider, env }, env,
      ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(201).send({
      target: {
        id:        row!.id,
        name:      row!.name,
        provider,
        env:       row!.env,
        connected: true,
        config:    row!.config,
      },
    });
  });

  // ── DELETE /api/publish/targets/:id ─────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/api/publish/targets/:id',
    async (req, reply) => {
      const ctx = req.authCtx!;
      requireRole(ctx, 'member');

      const db = getDb();
      const [existing] = await db
        .select()
        .from(publishTargets)
        .where(
          and(
            eq(publishTargets.id, req.params.id),
            eq(publishTargets.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);

      if (!existing) return reply.status(404).send({ error: 'Target not found' });

      await db.delete(publishTargets).where(eq(publishTargets.id, req.params.id));

      await writeAuditEvent({
        actor: ctx.userId, tenantId: ctx.tenantId,
        action: 'publish.target.delete', target: 'publish_targets', targetId: req.params.id,
        env: existing.env, ip: req.ip, ua: req.headers['user-agent'] ?? '',
      });

      return reply.send({ ok: true });
    },
  );

  // ── POST /api/publish/deploy ─────────────────────────────────────────────────
  app.post<{ Body: unknown }>('/api/publish/deploy', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = DeploySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }
    const { targetId, projectId, projectSlug, rootDir, entryPoint, framework, commitMsg, customDomain, cfZoneId } = parsed.data;

    // Validate co-required fields up front
    if (customDomain && !cfZoneId) {
      return reply.status(400).send({
        error: 'cfZoneId is required when customDomain is set. Pick a zone via GET /api/cf/zones first.',
      });
    }

    const db = getDb();

    // Verify the target belongs to this tenant
    const [target] = await db
      .select()
      .from(publishTargets)
      .where(
        and(
          eq(publishTargets.id, targetId),
          eq(publishTargets.tenantId, ctx.tenantId),
          eq(publishTargets.projectId, projectId),
        ),
      )
      .limit(1);

    if (!target) return reply.status(404).send({ error: 'Publish target not found' });

    // Round 8 Feature B (pending-customer gate): if this project is in
    // "pending customer payment" state, refuse the deploy with structured
    // info the IDE banner can render. Customer needs to pay the Stripe
    // invoice before the site can go live; rep should keep editing until
    // payment lands (SPS fires the transfer-ownership webhook that clears
    // this state automatically).
    try {
      const sql = getRawSql();
      const pendingRows = await sql.unsafe(
        `SELECT pending_customer_email, pending_invoice_id, pending_invoice_url, pending_until
           FROM projects
          WHERE id = $1 AND deleted_at IS NULL
            AND pending_until IS NOT NULL
            AND pending_until > now()
          LIMIT 1`,
        [projectId],
      ) as Array<{
        pending_customer_email: string | null;
        pending_invoice_id:     string | null;
        pending_invoice_url:    string | null;
        pending_until:          string | null;
      }>;
      if (pendingRows.length > 0) {
        const p = pendingRows[0]!;
        return reply.status(409).send({
          error:                  'pending_customer_payment',
          message:                'Project is pending customer invoice payment. Publishing is blocked until the invoice is paid (or expires).',
          pending_customer_email: p.pending_customer_email,
          pending_invoice_id:     p.pending_invoice_id,
          pending_invoice_url:    p.pending_invoice_url,
          pending_until:          p.pending_until,
        });
      }
    } catch (err) {
      // Migration timing: pending_* columns from 0015 may not exist yet on
      // an old DB. Don't block publishes on the gate query failing — the
      // gate is opt-in via assign-to-new-customer; if columns are missing
      // the gate is a no-op, which is correct for pre-Feature-B projects.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/column.*does not exist|relation.*does not exist/i.test(msg)) {
        // eslint-disable-next-line no-console
        console.warn(`[publish] pending-customer gate query failed (non-fatal): ${msg}`);
      }
    }

    // Production deploys require approval
    if (target.env === 'production') {
      return reply.status(202).send({
        requiresApproval: true,
        reason: 'Deployments to production require an approval from an admin or owner.',
        bundleSpec: { targetId, projectId, projectSlug, framework },
      });
    }

    // Two adapter implementations:
    //   • cloudflare-pages — pushes to Cloudflare Pages via the Direct Upload API
    //   • static-export    — uploads bundled assets to Supabase Storage + serves
    //                        them via /api/published/<slug>/*
    // The 'supabase' adapter is reserved for a future Supabase-Hosting flow.
    if (target.adapter !== 'cloudflare-pages' && target.adapter !== 'static-export') {
      return reply.status(400).send({
        error: `Adapter '${target.adapter}' is not yet supported for automated deploys.`,
      });
    }

    // Cloudflare credentials — only needed for the cloudflare-pages adapter
    const accountId = process.env['CF_ACCOUNT_ID'] ?? (target.config as Record<string, string>)?.['accountId'];
    const apiToken  = process.env['CF_API_TOKEN'];

    if (target.adapter === 'cloudflare-pages' && (!accountId || !apiToken)) {
      return reply.status(422).send({
        error: 'Cloudflare credentials not configured. Set CF_ACCOUNT_ID and CF_API_TOKEN on the server.',
      });
    }

    // ── Create deployment record (status=building) ────────────────────────────
    const [deployRow] = await db.insert(deployments).values({
      targetId,
      projectId,
      tenantId:    ctx.tenantId,
      status:      'building',
      env:         target.env,
      triggeredBy: ctx.userId,
      commitMsg:   commitMsg ?? null,
    }).returning();

    const deployId = deployRow!.id;

    // ── Bundle + deploy (async — respond immediately, update row when done) ────
    // We run this synchronously here (not fire-and-forget) so the response
    // carries the result. For long builds a job queue would be better,
    // but for typical static sites this completes in < 10s.
    try {
      // Resolve workspace files (same logic as preview boot)
      let resolvedRoot      = rootDir;
      let resolvedFramework = framework;

      const ws = await getWorkspace(ctx.tenantId, projectSlug);
      // If the workspace is empty (typical right after a server redeploy
      // wipes the ephemeral container disk), pull files back from Supabase
      // Storage. Mirrors chat.ts so deploy is self-healing across restarts.
      if (!(await workspaceExists(ws))) {
        await restoreWorkspaceFromStorage(ws).catch(() => { /* non-fatal */ });
      }
      const hasWorkspaceFiles = await workspaceExists(ws);

      if (hasWorkspaceFiles) {
        resolvedRoot = ws.rootDir;
        const hasReact  = await stat(`${ws.rootDir}/src/main.tsx`).then((s) => s.isFile()).catch(() => false);
        const hasHtml   = await stat(`${ws.rootDir}/index.html`).then((s) => s.isFile()).catch(() => false);
        if (hasReact)       resolvedFramework = 'react-vite';
        else if (hasHtml)   resolvedFramework = 'static';
        else throw new Error('Workspace has no supported entry point (need index.html or src/main.tsx).');
      }

      // Bundle — use '/' as base path for production (CF Pages handles routing)
      const bundleResult = await bundleProject({
        projectId,
        projectSlug,
        rootDir:      resolvedRoot,
        entryPoint,
        framework:    resolvedFramework,
        serveBasePath: '/',
      });

      if (bundleResult.errors.length > 0) {
        const errMsg = bundleResult.errors.join('\n');
        await db.update(deployments)
          .set({ status: 'failed', error: errMsg.slice(0, 1000), updatedAt: new Date() })
          .where(eq(deployments.id, deployId));
        return reply.status(422).send({ error: errMsg });
      }

      // ── Phase 3: optional signalpoint-config.json emission ────────────────
      // When the project is tagged with sps_workspace_id (Phase 2.5 column)
      // AND SPS's issuer endpoint is live (v2), embed signalpoint-config.json
      // alongside the HTML so the @abw/site-data shim can fetch live data.
      // v1 always returns null from the resolver — emission is dormant for
      // every project until SPS ships. Standalone-IDE guarantee preserved:
      // projects without sps_workspace_id never enter this branch.
      let projectSpsWorkspaceId: string | null = null;
      try {
        const rawSql = getRawSql();
        const rows = await rawSql.unsafe(
          `SELECT sps_workspace_id FROM projects WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [projectId, ctx.tenantId],
        ) as Array<{ sps_workspace_id: string | null }>;
        projectSpsWorkspaceId = rows[0]?.sps_workspace_id ?? null;
      } catch {
        // Migration 0014 not yet applied OR column doesn't exist — treat as standalone.
        projectSpsWorkspaceId = null;
      }
      if (projectSpsWorkspaceId) {
        const signalpointConfig = await resolveSignalpointConfigForProject({
          projectId,
          tenantId:        ctx.tenantId,
          spsWorkspaceId:  projectSpsWorkspaceId,
        });
        if (signalpointConfig) {
          bundleResult.assets.set('signalpoint-config.json', serializeSignalpointConfig(signalpointConfig));
        }
        // Note: resolver returning null here means SPS isn't reachable / not
        // yet wired. We don't fail the deploy — the bundle just publishes
        // without the config, and the shim's runtime fetch fallback handles
        // the absence (returns empty data, template renders fallback copy).
      }

      // Deploy via the chosen adapter
      let deployResult: { url: string; durationMs: number; deploymentId?: string };
      if (target.adapter === 'static-export') {
        const { deployStaticExport } = await import('../publish/staticExport');
        deployResult = await deployStaticExport({
          tenantId:    ctx.tenantId,
          projectSlug,
          assets:      bundleResult.assets,
          publicOrigin: process.env['PUBLIC_API_URL'] ?? `${req.protocol}://${req.headers.host}`,
        });
      } else {
        deployResult = await deployToCFPages(
          projectSlug,
          bundleResult.assets,
          accountId!,
          apiToken!,
        );
      }

      // ── Custom-domain attach (static-export adapter only) ────────────────────
      // After the upload succeeds, create the CNAME at the user's CF zone +
      // persist the customDomain on the publishTarget. The customHost route
      // then serves the deploy when traffic arrives with this Host header.
      // CNAME failures are FATAL — the user expects the URL to work; we'd
      // rather show them the error than silently leave them with a broken
      // domain.
      if (target.adapter === 'static-export' && customDomain && cfZoneId) {
        const cfToken = process.env['CF_API_TOKEN'];
        if (!cfToken) {
          throw new Error('Custom domain requested but CF_API_TOKEN not configured. Set it in Env & Secrets.');
        }

        const cnameTarget = (process.env['PUBLIC_API_HOST'] ??
          (process.env['PUBLIC_API_URL'] ? new URL(process.env['PUBLIC_API_URL']).host : null) ??
          'api.40-160-3-10.sslip.io').toLowerCase();

        const { cfFetch } = await import('@abw/publish');
        try {
          await cfFetch(
            `/zones/${cfZoneId}/dns_records`,
            cfToken,
            {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type:    'CNAME',
                name:    customDomain,
                content: cnameTarget,
                ttl:     1,        // CF "Auto"
                proxied: true,     // CF terminates TLS + caches at the edge
                comment: `AI Builder Workspace — published ${projectSlug}`,
              }),
            },
          );
        } catch (cnameErr) {
          const msg = cnameErr instanceof Error ? cnameErr.message : String(cnameErr);
          // 81057/81058 = "already exists" — fine, we just re-attach
          if (!/already exists|81057|81058/i.test(msg)) {
            throw new Error(`Could not create CNAME for ${customDomain}: ${msg}`);
          }
        }

        // Bind the host to the api app via Coolify so Traefik routes it.
        // CNAME alone gets us to Cloudflare's edge → our origin, but
        // Traefik 503s on unknown hosts. Coolify's API exposes the
        // docker_compose_domains list — append our host, then restart so
        // Traefik regenerates labels. Best-effort: if Coolify creds aren't
        // configured, the domain still resolves but visitors hit 503 until
        // someone manually adds it in the Coolify UI.
        try {
          const { getCoolifyConfig, ensureDomainBound, restartApplication } = await import('../publish/coolifyApi');
          const coolifyCfg = await getCoolifyConfig(ctx.tenantId, target.env);
          if (coolifyCfg) {
            const changed = await ensureDomainBound(customDomain, coolifyCfg);
            if (changed) {
              await restartApplication(coolifyCfg);
              // eslint-disable-next-line no-console
              console.log(`[publish] bound ${customDomain} to Coolify api app + restart queued`);
            } else {
              // eslint-disable-next-line no-console
              console.log(`[publish] ${customDomain} already bound in Coolify — no restart needed`);
            }
          } else {
            // eslint-disable-next-line no-console
            console.warn(`[publish] COOLIFY_API_TOKEN/COOLIFY_APP_UUID not in vault — skipping host bind. Add ${customDomain} manually in the Coolify UI under Domains for api.`);
          }
        } catch (coolifyErr) {
          const msg = coolifyErr instanceof Error ? coolifyErr.message : String(coolifyErr);
          // eslint-disable-next-line no-console
          console.warn(`[publish] Coolify host-bind failed (non-fatal): ${msg}`);
        }

        // Persist customDomain on the target (merging with existing config jsonb)
        const existingConfig = (target.config ?? {}) as Record<string, unknown>;
        await db.update(publishTargets)
          .set({
            config: { ...existingConfig, customDomain, cfZoneId, cnameTarget },
            updatedAt: new Date(),
          } as Record<string, unknown>)
          .where(eq(publishTargets.id, targetId));

        // Override the deploy URL to the user's domain
        deployResult.url = `https://${customDomain}/`;

        // Bust the customHost cache so the very next request resolves
        const { invalidateHostCache } = await import('../routes/customHost');
        invalidateHostCache(customDomain);
      }

      // Update deployment row: success
      await db.update(deployments)
        .set({
          status:     'success',
          url:        deployResult.url,
          durationMs: deployResult.durationMs,
          updatedAt:  new Date(),
        })
        .where(eq(deployments.id, deployId));

      // Update target's last-deploy fields
      await db.update(publishTargets)
        .set({
          lastDeployAt:  new Date(),
          lastDeployUrl: deployResult.url,
          updatedAt:     new Date(),
        })
        .where(eq(publishTargets.id, targetId));

      await writeAuditEvent({
        actor: ctx.userId, tenantId: ctx.tenantId,
        action: 'publish.deploy.success', target: 'deployments', targetId: deployId,
        after: { url: deployResult.url, durationMs: deployResult.durationMs },
        env: target.env, ip: req.ip, ua: req.headers['user-agent'] ?? '',
      });

      return reply.send({
        deploymentId: deployId,
        status:       'success',
        url:          deployResult.url,
        durationMs:   deployResult.durationMs,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      await db.update(deployments)
        .set({ status: 'failed', error: msg.slice(0, 1000), updatedAt: new Date() })
        .where(eq(deployments.id, deployId));

      await writeAuditEvent({
        actor: ctx.userId, tenantId: ctx.tenantId,
        action: 'publish.deploy.failed', target: 'deployments', targetId: deployId,
        after: { error: msg }, env: target.env,
        ip: req.ip, ua: req.headers['user-agent'] ?? '',
      });

      return reply.status(500).send({ error: msg });
    }
  });

  // ── GET /api/publish/deployments?projectId= ──────────────────────────────────
  app.get<{ Querystring: { projectId?: string; limit?: string } }>(
    '/api/publish/deployments',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const parsed = ListDeploymentsSchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send({ error: 'projectId required' });

      const db = getDb();
      const rows = await db
        .select({
          id:          deployments.id,
          targetId:    deployments.targetId,
          status:      deployments.status,
          env:         deployments.env,
          url:         deployments.url,
          triggeredBy: deployments.triggeredBy,
          commitMsg:   deployments.commitMsg,
          durationMs:  deployments.durationMs,
          error:       deployments.error,
          createdAt:   deployments.createdAt,
          // include target name via join
          targetName:  publishTargets.name,
        })
        .from(deployments)
        .innerJoin(publishTargets, eq(deployments.targetId, publishTargets.id))
        .where(
          and(
            eq(deployments.projectId, parsed.data.projectId),
            eq(deployments.tenantId, ctx.tenantId),
          ),
        )
        .orderBy(desc(deployments.createdAt))
        .limit(parsed.data.limit);

      return {
        deployments: rows.map((r) => ({
          id:          r.id,
          targetId:    r.targetId,
          targetName:  r.targetName,
          status:      r.status,
          env:         r.env,
          url:         r.url ?? undefined,
          triggeredBy: r.triggeredBy,
          commitMsg:   r.commitMsg ?? undefined,
          durationMs:  r.durationMs ?? undefined,
          error:       r.error ?? undefined,
          startedAt:   r.createdAt.toISOString(),
        })),
      };
    },
  );
}
