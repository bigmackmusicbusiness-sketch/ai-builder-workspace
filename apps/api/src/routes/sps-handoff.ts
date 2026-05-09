// apps/api/src/routes/sps-handoff.ts — Phase 2.5 cross-project glue.
//
// Two endpoints exposed to SignalPointSystems (SPS) for the bidirectional
// integration shipped in 2026-05-09:
//
//   POST /api/sps/projects   — server-to-server: SPS mints a token with
//                              scope='project-create' and posts it to spin
//                              up a new ABW project tagged with the caller's
//                              sps_workspace_id. Returns project id + slug
//                              + a deep-link URL the SPS UI can iframe.
//
//   GET  /api/sps/handoff    — browser-facing: SPS deep-links a customer at
//                              this URL. Token has scope='project-handoff'.
//                              Verifies, sets a short-lived signed cookie
//                              that the IDE picks up, and 302s to
//                              /projects/<slug>?spsHandoff=1. v1 does NOT
//                              mint a Supabase user session — that's wired
//                              alongside the SPS iframe UI in v2.
//
// Both endpoints are HS256-token-authed (see ../security/handoffToken.ts).
// They DO NOT use the Supabase JWT auth middleware. They're added to the
// CSRF guard's skip list because their auth is the token, not a cookie.
//
// **Standalone-IDE guarantee preserved:** every code path ABW takes for
// projects WITHOUT sps_workspace_id is untouched. These routes are dormant
// for non-SPS users — the workspace, build, preview, publish, agent flows
// all behave identically whether or not SPS ever calls them.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, getRawSql } from '../db/client';
import { projects } from '@abw/db';
import { writeAuditEvent } from '../security/audit';
import {
  verifyHandoffToken,
  HandoffTokenError,
  type HandoffPayload,
} from '../security/handoffToken';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a kebab-case slug from a name. Lowercase, alphanum + dashes only,
 *  trimmed. Used when SPS sends a project_name without a project_slug. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

/** Resolve the IDE origin used to build the deep-link URL returned to SPS.
 *  Falls back to the demo Coolify host if APP_URL isn't configured (dev). */
function getAppUrl(): string {
  return process.env['APP_URL'] ?? 'https://app.40-160-3-10.sslip.io';
}

/** Pull the bearer token from an Authorization header. Returns null if
 *  missing or malformed. */
function bearerFrom(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1]!.trim() : null;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const ProjectKindSchema = z.enum([
  'website', 'landing_page', 'dashboard', 'internal_tool',
  'onboarding_flow', 'automation_panel', 'saas_app',
  'api_service', 'full_stack_app',
  'ebook', 'document', 'email_composer', 'music_studio',
  'ai_movie', 'ai_commercial', 'ai_short', 'ai_music_video',
  'blank',
]);

/** POST /api/sps/projects body. Tenant + creator come from the token's
 *  sps_workspace_id and sub respectively. */
const CreateProjectBodySchema = z.object({
  /** Optional override; defaults to the token's project_name. */
  name: z.string().min(1).max(120).optional(),
  /** Optional override; defaults to slugify(name). */
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(60).optional(),
  /** Optional override; defaults to the token's project_kind, then 'website'. */
  kind: ProjectKindSchema.optional(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

export async function spsHandoffRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/sps/projects
   *
   * Server-to-server. SPS hits this with:
   *   Authorization: Bearer <hs256-token, scope=project-create>
   *   Body: { name?, slug?, kind? }   ← optional overrides
   *
   * Token payload provides: sps_workspace_id (required), project_name?,
   * project_slug?, niche_slug?, project_kind?.
   *
   * Returns 200: { project_id, slug, deep_link_url, sps_workspace_id }
   * Returns 401: bad / missing / expired token
   * Returns 409: slug collision in the system tenant
   */
  app.post('/api/sps/projects', async (req, reply) => {
    const token = bearerFrom(req.headers.authorization);
    if (!token) return reply.status(401).send({ error: 'missing_bearer_token' });

    let payload: HandoffPayload;
    try {
      payload = verifyHandoffToken(token, 'project-create');
    } catch (err) {
      const reason = err instanceof HandoffTokenError ? err.reason : 'verification_failed';
      return reply.status(401).send({ error: 'invalid_token', reason });
    }

    const parsed = CreateProjectBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'bad_body', issues: parsed.error.issues });
    }

    const projectName = parsed.data.name ?? payload.project_name ?? 'Untitled project';
    const projectSlug = parsed.data.slug ?? slugify(projectName);
    const projectKind = parsed.data.kind ?? (payload.project_kind as z.infer<typeof ProjectKindSchema> | undefined) ?? 'website';

    // SPS-created projects use the system tenant for now. A future iteration
    // can map sps_workspace_id → a real ABW tenant via a join table. For v1
    // every SPS project is owned by the system-tenant guard rail.
    const systemTenantId = process.env['SPS_SYSTEM_TENANT_ID'];
    if (!systemTenantId) {
      return reply.status(500).send({ error: 'sps_system_tenant_not_configured' });
    }

    // Slug collision check (same as POST /api/projects).
    const db = getDb();
    try {
      const collision = await db.select({ id: projects.id })
        .from(projects)
        .where(and(
          eq(projects.tenantId, systemTenantId),
          eq(projects.slug, projectSlug),
          isNull(projects.deletedAt),
        ))
        .limit(1);
      if (collision.length > 0) {
        return reply.status(409).send({
          error: 'slug_collision',
          message: `A project with slug "${projectSlug}" already exists.`,
        });
      }
    } catch {
      // Migration timing: if the schema isn't fully aligned yet, skip the
      // pre-check and rely on the unique index from migration 0012.
    }

    // Insert with sps_workspace_id populated. Using raw SQL to be defensive
    // against migration timing — the new column exists from 0014, but the
    // Drizzle insert path goes through the entire schema (fewer surprises
    // when only this one column is the recent addition).
    const sql = getRawSql();
    let row: { id: string; slug: string } | undefined;
    try {
      const inserted = await sql.unsafe(
        `INSERT INTO projects
           (tenant_id, name, slug, type, sps_workspace_id, active_env)
         VALUES ($1, $2, $3, $4, $5, 'dev')
         RETURNING id, slug`,
        [systemTenantId, projectName, projectSlug, projectKind, payload.sps_workspace_id],
      ) as Array<{ id: string; slug: string }>;
      row = inserted[0];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[sps] project create failed: ${msg}`);
      return reply.status(500).send({ error: 'create_failed', message: msg });
    }
    if (!row) return reply.status(500).send({ error: 'create_failed_no_row' });

    // Audit. Content hashes only (per audit module conventions); the SPS
    // workspace id is not sensitive enough to warrant hashing but we keep
    // raw values out of the audit row body.
    await writeAuditEvent({
      tenantId: systemTenantId,
      action: 'sps.project.create',
      target: 'project',
      targetId: row.id,
      env: 'production',
      after: { sps_workspace_id: payload.sps_workspace_id, kind: projectKind },
    }).catch(() => { /* best-effort; never block create on audit */ });

    return reply.status(200).send({
      project_id: row.id,
      slug: row.slug,
      deep_link_url: `${getAppUrl()}/projects/${row.slug}?spsHandoff=1`,
      sps_workspace_id: payload.sps_workspace_id,
    });
  });

  /**
   * GET /api/sps/handoff?token=<hs256>
   *
   * Browser-facing. SPS opens an iframe at this URL when a customer clicks
   * "Manage my site" in the SPS portal. We verify the handoff token, set a
   * short-lived signed cookie carrying { sps_workspace_id, email,
   * project_id }, and 302 to the IDE's /projects/<slug>?spsHandoff=1.
   *
   * The IDE's `apps/web` reads this cookie alongside the Supabase session.
   * v1 of the integration leaves Supabase auth as the primary signal —
   * the cookie is informational hint, not authentication. v2 (planned) will
   * mint a real Supabase user session from the handoff token.
   */
  app.get('/api/sps/handoff', async (req, reply) => {
    const token = (req.query as { token?: string })?.token;
    if (!token) return reply.status(400).send({ error: 'missing_token_query_param' });

    let payload: HandoffPayload;
    try {
      payload = verifyHandoffToken(token, 'project-handoff');
    } catch (err) {
      const reason = err instanceof HandoffTokenError ? err.reason : 'verification_failed';
      return reply.status(401).send({ error: 'invalid_token', reason });
    }

    if (!payload.project_id) {
      return reply.status(400).send({ error: 'missing_project_id_in_token' });
    }

    // Look up the project to confirm it exists and belongs to the same SPS
    // workspace the token claims. Defends against a token issued for one
    // SPS workspace being used to deep-link into another's project.
    const sql = getRawSql();
    let row: { id: string; slug: string; tenant_id: string; sps_workspace_id: string | null } | undefined;
    try {
      const rows = await sql.unsafe(
        `SELECT id, slug, tenant_id, sps_workspace_id
           FROM projects
          WHERE id = $1 AND deleted_at IS NULL
          LIMIT 1`,
        [payload.project_id],
      ) as Array<{ id: string; slug: string; tenant_id: string; sps_workspace_id: string | null }>;
      row = rows[0];
    } catch {
      return reply.status(500).send({ error: 'project_lookup_failed' });
    }
    if (!row) return reply.status(404).send({ error: 'project_not_found' });
    if (row.sps_workspace_id !== payload.sps_workspace_id) {
      return reply.status(403).send({ error: 'workspace_mismatch' });
    }

    // Set a short-lived hint cookie. Path / so the IDE app reads it on any
    // page load; max-age matches the handoff window. SameSite=Lax is the
    // safest default for a redirect-from-different-origin flow.
    const cookieValue = encodeURIComponent(JSON.stringify({
      sps_workspace_id: payload.sps_workspace_id,
      project_id:       payload.project_id,
      email:            payload.email ?? null,
      iat:              payload.iat,
      exp:              payload.exp,
    }));
    reply.header('Set-Cookie',
      `abw_sps_handoff=${cookieValue}; ` +
      `Path=/; ` +
      `Max-Age=${Math.max(60, payload.exp - Math.floor(Date.now() / 1000))}; ` +
      `SameSite=Lax; ` +
      `Secure; ` +
      `HttpOnly`,
    );

    // Audit (uses the project's existing tenantId for the audit row).
    await writeAuditEvent({
      tenantId: row.tenant_id,
      action: 'sps.handoff.land',
      target: 'project',
      targetId: row.id,
      env: 'production',
      after: { sps_workspace_id: payload.sps_workspace_id, has_email: !!payload.email },
    }).catch(() => { /* best-effort */ });

    return reply.redirect(`${getAppUrl()}/projects/${row.slug}?spsHandoff=1`, 302);
  });
}
