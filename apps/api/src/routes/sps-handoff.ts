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
import { runEagerKickoff } from '../agent/kickoffRunner';
import { runChatTurn } from '../agent/chatRunner';
import { mintSpsHandoffMagicLink } from '../security/spsAuthBridge';

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
    // page load; max-age matches the handoff window.
    //
    // **SameSite=None; Secure** is required (not Lax) because the handoff
    // flow is increasingly invoked inside cross-origin iframes (SPS round 8
    // Feature A — SPS embeds the IDE inside their admin + customer portals).
    // In an iframe loaded from a different origin (e.g.
    // app.signalpointportal.com → app.40-160-3-10.sslip.io), this cookie is
    // treated as third-party. SameSite=Lax → cookie not sent → auth breaks.
    // SameSite=None requires Secure (already set) — no functional change for
    // top-level redirects (browsers send None cookies on top-level nav too).
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
      `SameSite=None; ` +
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

    // Forward the `embedded=true` query param (round 8 Feature A — iframe
    // mode flag). SPS sets this on the iframe src to tell the SPA to hide
    // its top chrome. If the incoming request has it, preserve it on the
    // redirect; the SPA's Shell.tsx reads it on mount and stashes it in
    // sessionStorage for the iframe's lifetime.
    const incomingEmbedded = (req.query as { embedded?: string })?.embedded === 'true';
    const embeddedSuffix = incomingEmbedded ? '&embedded=true' : '';
    const projectUrl = `${getAppUrl()}/projects/${row.slug}?spsHandoff=1${embeddedSuffix}`;

    // Round 13.2 — Option C session bridge.
    //
    // Instead of redirecting directly to the SPA (which would land
    // unauthenticated and 401 on every api call), we redirect through a
    // Supabase magic-link verify URL. Supabase mints a real session for
    // the shared SPS proxy user, then 302s to the SPA URL above with
    // access + refresh tokens in the URL fragment. The SPA's Supabase
    // client (configured detectSessionInUrl: true) picks them up and
    // hydrates the session, so apiFetch works for the rest of the
    // iframe's lifetime.
    //
    // If the magic-link mint fails (Supabase admin error, env not
    // configured, etc.) we fall back to the bare redirect with a flag
    // so the SPA can show a clearer error than the silent "Project
    // not found" state. Better to land with an obvious "couldn't sign
    // you in" message than a misleading routing-looks-broken UX.
    try {
      const { actionLink } = await mintSpsHandoffMagicLink({ redirectTo: projectUrl });
      return reply.redirect(actionLink, 302);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[sps-handoff] magic-link mint failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return reply.redirect(`${projectUrl}&spsAuthFailed=1`, 302);
    }
  });

  /**
   * POST /api/sps/projects/:id/transfer-ownership
   *
   * Round 8 Feature B (IDE-first customer creation with pending invoice).
   *
   * Called by SPS when a Stripe invoice for an ABW-built site has been paid
   * (webhook `invoice.paid`) — re-parents the project from the agency
   * tenant's spsWorkspaceId to the customer's newly-activated workspace.
   * Also called by SPS when a pending invoice expires (30 days unpaid) to
   * revert ownership back to the agency.
   *
   * Auth: SPS S2S bearer with
   *   iss = 'signalpoint-systems'
   *   aud = 'abw'
   *   scope = 'transfer-ownership'
   *   sps_workspace_id = <new workspace UUID> (must match body)
   *   exp <= iat + 300s
   *
   * Body: { new_sps_workspace_id: <uuid> }
   *
   * Returns 200: { ok, project_id, old_sps_workspace_id, new_sps_workspace_id, no_op? }
   * Returns 400: bad body
   * Returns 401: bad / missing / expired token
   * Returns 403: body.new_sps_workspace_id != token.sps_workspace_id
   * Returns 404: project doesn't exist or is soft-deleted
   *
   * Idempotent: calling with new_sps_workspace_id == current sps_workspace_id
   * is a no-op (returns ok=true, no_op=true). Standalone-IDE guarantee held:
   * pending-state columns are cleared on success, so a re-parented project
   * returns to standard publish flow.
   */
  const TransferOwnershipBodySchema = z.object({
    new_sps_workspace_id: z.string().uuid(),
  });

  app.post<{ Params: { id: string }; Body: { new_sps_workspace_id?: string } }>(
    '/api/sps/projects/:id/transfer-ownership',
    async (req, reply) => {
      const token = bearerFrom(req.headers.authorization);
      if (!token) return reply.status(401).send({ error: 'missing_bearer_token' });

      let payload: HandoffPayload;
      try {
        payload = verifyHandoffToken(token, 'transfer-ownership');
      } catch (err) {
        const reason = err instanceof HandoffTokenError ? err.reason : 'verification_failed';
        return reply.status(401).send({ error: 'invalid_token', reason });
      }

      const projectId = req.params.id;
      if (typeof projectId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
        return reply.status(400).send({ error: 'invalid_project_id' });
      }

      const parsed = TransferOwnershipBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'bad_body', issues: parsed.error.issues });
      }
      const newWs = parsed.data.new_sps_workspace_id.toLowerCase();
      /** SPS round-9 documented the all-zeros UUID as the sentinel for
       *  "revert to no SPS owner" (the 30-day expiry worker uses this when
       *  rolling a project back from a never-paid customer to the agency
       *  tenant). new_sps_workspace_id must be a UUID for our Zod schema,
       *  so SPS sends 00000000-0000-0000-0000-000000000000; we map it to
       *  NULL on storage so projects.sps_workspace_id is semantically
       *  accurate ("not currently SPS-owned"). */
      const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
      const isRevert = newWs === ZERO_UUID;

      // The token's sps_workspace_id MUST match the body — defends against
      // a token issued for workspace A being used to claim project ownership
      // for workspace B. Mirrors the same check on /api/sps/handoff.
      if (payload.sps_workspace_id.toLowerCase() !== newWs) {
        return reply.status(403).send({ error: 'workspace_mismatch' });
      }

      // Lookup current project state.
      const sql = getRawSql();
      let row: { id: string; sps_workspace_id: string | null; tenant_id: string } | undefined;
      try {
        const rows = await sql.unsafe(
          `SELECT id, sps_workspace_id, tenant_id
             FROM projects
            WHERE id = $1 AND deleted_at IS NULL
            LIMIT 1`,
          [projectId],
        ) as Array<{ id: string; sps_workspace_id: string | null; tenant_id: string }>;
        row = rows[0];
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[sps] transfer-ownership project lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        return reply.status(500).send({ error: 'project_lookup_failed' });
      }
      if (!row) return reply.status(404).send({ error: 'project_not_found' });

      const oldWs = row.sps_workspace_id;
      // What we'll WRITE to projects.sps_workspace_id. For the revert
      // sentinel, NULL is the right value (no SPS owner). Otherwise it's
      // the new workspace UUID.
      const writeValue: string | null = isRevert ? null : newWs;

      // Idempotency: same-workspace call is a no-op. For revert: compare
      // against NULL specifically (the all-zeros sentinel maps to NULL on
      // storage, so a re-revert of an already-NULL project is a no-op).
      const alreadyAtTarget = isRevert ? oldWs === null : oldWs === newWs;
      if (alreadyAtTarget) {
        return reply.send({
          ok:                    true,
          project_id:            row.id,
          old_sps_workspace_id:  oldWs,
          new_sps_workspace_id:  writeValue,
          no_op:                 true,
        });
      }

      // Update the project + clear all four pending-customer columns. The
      // pending state belongs to the BEFORE-payment phase; once SPS confirms
      // payment + transfer-ownership, the project is "live" in the IDE's
      // sense (no banner, publish unblocked). On revert (writeValue=null),
      // pending state is also cleared — the customer didn't pay and the
      // project is going back to the agency.
      try {
        await sql.unsafe(
          `UPDATE projects
              SET sps_workspace_id           = $1,
                  pending_customer_email     = NULL,
                  pending_stripe_session_id  = NULL,
                  pending_payment_url        = NULL,
                  pending_until              = NULL,
                  updated_at                 = now()
            WHERE id = $2 AND deleted_at IS NULL`,
          [writeValue, projectId],
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[sps] transfer-ownership update failed: ${err instanceof Error ? err.message : String(err)}`);
        return reply.status(500).send({ error: 'update_failed' });
      }

      // Audit — record the before/after workspace mapping. Useful for
      // operator forensics if a customer disputes ownership. `is_revert`
      // distinguishes payment-success transfers from 30-day-expiry reverts.
      await writeAuditEvent({
        tenantId: row.tenant_id,
        action:   'sps.project.transfer_ownership',
        target:   'project',
        targetId: row.id,
        env:      'production',
        before:   { sps_workspace_id: oldWs },
        after:    { sps_workspace_id: writeValue, cleared_pending: true, is_revert: isRevert },
      }).catch(() => { /* best-effort */ });

      return reply.send({
        ok:                    true,
        project_id:            row.id,
        old_sps_workspace_id:  oldWs,
        new_sps_workspace_id:  writeValue,
        is_revert:             isRevert,
      });
    },
  );

  /**
   * POST /api/sps/projects/:projectId/kickoff
   *
   * Round 12 — SPS auto-onboarding seeds an existing ABW project's first
   * chat message via this endpoint. Eager mode (Option B): we persist
   * the row + immediately fire the agent run server-side. The customer
   * arrives to a finished site, not a "click here to start" stub.
   *
   * Auth: HS256 with scope='project-kickoff'. Token must carry
   *   sps_workspace_id (UUID) AND project_id (UUID). The token's
   *   project_id MUST match the path param (path-bind defense, same
   *   strictness as transfer-ownership) AND the project's stored
   *   sps_workspace_id MUST match the token's claim. ≤ 5min lifetime.
   *
   * Body:
   *   {
   *     content: string ≤ 16KB,
   *     metadata?: {
   *       source: 'sps_onboarding_v1' | …,
   *       onboarding_flow_id: string,
   *       qc_approved_at?: ISO8601,
   *       qc_artifact_id?: string
   *     }
   *   }
   *
   * Idempotency:
   *   - Same `onboarding_flow_id` for the same project: 200 with the
   *     ORIGINAL kickoff_id + CURRENT status. SPS can safely retry on
   *     transient network failures (per their round 12.1 request).
   *   - Different `onboarding_flow_id` while a kickoff is queued/running
   *     on the same project: 409 already_kicked_off. Prevents
   *     accidentally firing two parallel agent runs.
   *   - Different `onboarding_flow_id` after the previous one is
   *     completed/failed/cancelled: 200, a new run kicks off.
   *
   * Returns 200: { ok: true, kickoff_id, project_id, status }
   * Returns 400/401/403/404/409/500 — all JSON, never HTML.
   */
  app.post<{
    Params: { projectId: string };
    Body:   { content?: unknown; metadata?: unknown };
  }>(
    '/api/sps/projects/:projectId/kickoff',
    async (req, reply) => {
      const projectIdParam = (req.params as { projectId?: string }).projectId;
      if (!projectIdParam) {
        return reply.status(400).send({ ok: false, error: 'missing_project_id_path_param' });
      }

      const token = bearerFrom(req.headers.authorization);
      if (!token) return reply.status(401).send({ ok: false, error: 'missing_bearer_token' });

      let payload: HandoffPayload;
      try {
        payload = verifyHandoffToken(token, 'project-kickoff');
      } catch (err) {
        const reason = err instanceof HandoffTokenError ? err.reason : 'verification_failed';
        return reply.status(401).send({ ok: false, error: 'invalid_token', reason });
      }

      if (!payload.project_id) {
        return reply.status(400).send({ ok: false, error: 'missing_project_id_in_token' });
      }
      if (payload.project_id.toLowerCase() !== projectIdParam.toLowerCase()) {
        return reply.status(403).send({ ok: false, error: 'project_mismatch' });
      }

      // Body validation. Content is required + size-capped; metadata is
      // optional but normalised to a flat object we can json-stringify.
      const bodyParse = z.object({
        content:  z.string().min(1).max(16_384),
        metadata: z.object({
          source:             z.string().max(120).optional(),
          onboarding_flow_id: z.string().min(1).max(120).optional(),
          qc_approved_at:     z.string().datetime().optional(),
          qc_artifact_id:     z.string().max(120).optional(),
        }).passthrough().optional(),
      }).safeParse(req.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          ok:     false,
          error:  'bad_body',
          issues: bodyParse.error.format(),
        });
      }
      const body = bodyParse.data;
      const onboardingFlowId = body.metadata?.onboarding_flow_id ?? null;
      const qcArtifactId     = body.metadata?.qc_artifact_id     ?? null;
      const metadataJson     = body.metadata ?? {};

      // Look up the project + verify the token's sps_workspace_id matches
      // what's stored on the project. Same defense as transfer-ownership:
      // a token issued for workspace A must not be able to drive workspace
      // B's project.
      const sql = getRawSql();
      let proj: { id: string; tenant_id: string; sps_workspace_id: string | null } | undefined;
      try {
        const rows = await sql.unsafe(
          `SELECT id, tenant_id, sps_workspace_id
             FROM projects
            WHERE id = $1 AND deleted_at IS NULL
            LIMIT 1`,
          [projectIdParam],
        ) as Array<{ id: string; tenant_id: string; sps_workspace_id: string | null }>;
        proj = rows[0];
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[kickoff] project lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        return reply.status(500).send({ ok: false, error: 'project_lookup_failed' });
      }
      if (!proj) return reply.status(404).send({ ok: false, error: 'project_not_found' });
      if (proj.sps_workspace_id !== payload.sps_workspace_id) {
        return reply.status(403).send({ ok: false, error: 'workspace_mismatch' });
      }

      // Idempotency lookup. If the same (project_id, onboarding_flow_id)
      // already exists, return the ORIGINAL row's id + current status
      // (per SPS round 12.1 request). Skipped when no flow id was sent —
      // that's a dev/test path; we don't try to dedupe without a key.
      if (onboardingFlowId) {
        try {
          const existing = await sql.unsafe(
            `SELECT id, status FROM project_kickoff_messages
              WHERE project_id = $1 AND onboarding_flow_id = $2 AND deleted_at IS NULL
              LIMIT 1`,
            [proj.id, onboardingFlowId],
          ) as Array<{ id: string; status: string }>;
          if (existing.length > 0) {
            return reply.send({
              ok:         true,
              kickoff_id: existing[0]!.id,
              project_id: proj.id,
              status:     existing[0]!.status,
              idempotent: true,
            });
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[kickoff] idempotency lookup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 409 guard: a kickoff is already queued/running on this project
      // under a different flow id. Reject so we don't accidentally fire
      // two parallel agent runs. Completed / failed / cancelled rows do
      // not block a fresh kickoff.
      try {
        const active = await sql.unsafe(
          `SELECT id, status, onboarding_flow_id
             FROM project_kickoff_messages
            WHERE project_id = $1
              AND status IN ('queued', 'running')
              AND deleted_at IS NULL
            LIMIT 1`,
          [proj.id],
        ) as Array<{ id: string; status: string; onboarding_flow_id: string | null }>;
        if (active.length > 0) {
          return reply.status(409).send({
            ok:                       false,
            error:                    'already_kicked_off',
            existing_kickoff_id:      active[0]!.id,
            existing_status:          active[0]!.status,
            existing_onboarding_flow_id: active[0]!.onboarding_flow_id,
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[kickoff] active-kickoff lookup failed (non-fatal, proceeding): ${err instanceof Error ? err.message : String(err)}`);
      }

      // Insert the kickoff row. Drizzle would work too but raw SQL keeps
      // us defensive against migration timing — the table only landed in
      // 0016 and we'd rather a clear error than a silently-failing typed
      // insert if the migration hasn't applied yet on a given env.
      let kickoffId: string;
      try {
        const inserted = await sql.unsafe(
          `INSERT INTO project_kickoff_messages
             (project_id, tenant_id, content, metadata, status,
              onboarding_flow_id, qc_artifact_id)
           VALUES ($1, $2, $3, $4::jsonb, 'queued', $5, $6)
           RETURNING id`,
          [
            proj.id,
            proj.tenant_id,
            body.content,
            JSON.stringify(metadataJson),
            onboardingFlowId,
            qcArtifactId,
          ],
        ) as Array<{ id: string }>;
        kickoffId = inserted[0]!.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Unique violation on (project_id, onboarding_flow_id) — handle
        // the race where two concurrent requests with the same flow id
        // pass the SELECT but both try to INSERT. Re-fetch + return.
        if (onboardingFlowId && /duplicate key value|unique constraint/i.test(msg)) {
          try {
            const refetch = await sql.unsafe(
              `SELECT id, status FROM project_kickoff_messages
                WHERE project_id = $1 AND onboarding_flow_id = $2 AND deleted_at IS NULL
                LIMIT 1`,
              [proj.id, onboardingFlowId],
            ) as Array<{ id: string; status: string }>;
            if (refetch.length > 0) {
              return reply.send({
                ok:         true,
                kickoff_id: refetch[0]!.id,
                project_id: proj.id,
                status:     refetch[0]!.status,
                idempotent: true,
              });
            }
          } catch { /* fall through to 500 */ }
        }
        // eslint-disable-next-line no-console
        console.error(`[kickoff] insert failed: ${msg}`);
        return reply.status(500).send({ ok: false, error: 'insert_failed' });
      }

      // Fire the eager runner. Fire-and-forget — the response goes back
      // immediately with status='running'; the runner persists progress
      // into agent_runs + agent_steps + flips the kickoff row to
      // completed/failed when done. Errors inside the runner are
      // swallowed (logged + persisted to the row); they never bubble
      // out of the route handler.
      void runEagerKickoff(kickoffId).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[kickoff] runner crashed for ${kickoffId}: ${err instanceof Error ? err.message : String(err)}`);
      });

      // Audit. Content hash only — the brief can contain customer info
      // we don't want denormalised into the audit log.
      await writeAuditEvent({
        tenantId: proj.tenant_id,
        action:   'sps.project.kickoff',
        target:   'project',
        targetId: proj.id,
        env:      'production',
        after: {
          kickoff_id:          kickoffId,
          sps_workspace_id:    payload.sps_workspace_id,
          onboarding_flow_id:  onboardingFlowId,
          qc_artifact_id:      qcArtifactId,
          content_bytes:       body.content.length,
        },
      }).catch(() => { /* best-effort */ });

      return reply.send({
        ok:         true,
        kickoff_id: kickoffId,
        project_id: proj.id,
        status:     'running',
      });
    },
  );

  /**
   * POST /api/sps/projects/:projectId/chat
   *
   * Round 14 — SPS's autonomous build-driver agent posts a user
   * message into the project's chat. By default (`trigger_agent: true`)
   * the ABW agent runs synchronously inside this request, persisting
   * its assistant + tool messages back to `chat_messages` so the
   * driver's GET poll sees them. The 200 response carries the new
   * `message_id` + the `agent_run_id` (or null when trigger_agent=false).
   *
   * Auth: HS256 `project-chat` scope. Token must carry
   *   sps_workspace_id + project_id (path-bound). ≤ 5min lifetime.
   *
   * Body:
   *   {
   *     role:    "user",                       // required, must be "user"
   *     content: "<text, ≤ 16KB>",
   *     trigger_agent:  true,                  // optional, default true
   *     force_new_run:  false                  // optional, default false
   *   }
   *
   * `force_new_run` (round 14.2 unblock): opt-out for the 409 concurrency
   * guard. When `true` and a `running` agent_run exists for this project,
   * ABW marks that run as `failed` (summary appended with replacement
   * marker) and proceeds with the new turn. Use case: SPS's "Re-trigger"
   * button — operator knows a previous run is wedged. Default behavior
   * (`false` / omitted) preserves the strict 409 contract for the
   * automated build-driver.
   *
   * 200:  { ok, message_id, appended_at, agent_run_id | null,
   *         replaced_run_id? }       // replaced_run_id set iff force_new_run cleared a run
   * 400:  bad_body / message_too_large / unsupported_role
   * 401:  invalid_token (signature, expiry, audience, issuer, scope)
   * 403:  wrong_project / workspace_mismatch
   * 404:  project_not_found
   * 409:  agent_run_in_progress (with current_run_id + started_at)
   *         — never returned when force_new_run is true
   * 500:  internal_error / force_new_run_mark_failed
   */
  app.post<{
    Params: { projectId: string };
    Body:   { role?: unknown; content?: unknown; trigger_agent?: unknown; force_new_run?: unknown };
  }>(
    '/api/sps/projects/:projectId/chat',
    async (req, reply) => {
      const projectIdParam = (req.params as { projectId?: string }).projectId;
      if (!projectIdParam) {
        return reply.status(400).send({ ok: false, error: 'missing_project_id_path_param' });
      }

      const token = bearerFrom(req.headers.authorization);
      if (!token) return reply.status(401).send({ ok: false, error: 'missing_bearer_token' });

      let payload: HandoffPayload;
      try {
        payload = verifyHandoffToken(token, 'project-chat');
      } catch (err) {
        const reason = err instanceof HandoffTokenError ? err.reason : 'verification_failed';
        return reply.status(401).send({ ok: false, error: 'invalid_token', reason });
      }

      if (!payload.project_id) {
        return reply.status(400).send({ ok: false, error: 'missing_project_id_in_token' });
      }
      if (payload.project_id.toLowerCase() !== projectIdParam.toLowerCase()) {
        return reply.status(403).send({ ok: false, error: 'wrong_project' });
      }

      // Body validation. Role must be "user" (assistant/tool/system
      // messages come from the agent runner, not from external posts).
      // `force_new_run` (round 14.2 unblock) lets the caller clear a
      // stuck `running` agent_run for this project — see endpoint doc
      // comment above for the use case.
      const bodyParse = z.object({
        role:          z.literal('user').optional().default('user'),
        content:       z.string().min(1).max(16_384),
        trigger_agent: z.boolean().optional().default(true),
        force_new_run: z.boolean().optional().default(false),
      }).safeParse(req.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          ok:     false,
          error:  'bad_body',
          issues: bodyParse.error.format(),
        });
      }
      const body = bodyParse.data;

      // Look up the project + verify workspace claim. Same defense as
      // the kickoff endpoint.
      const sql = getRawSql();
      let proj: { id: string; tenant_id: string; sps_workspace_id: string | null } | undefined;
      try {
        const rows = await sql.unsafe(
          `SELECT id, tenant_id, sps_workspace_id
             FROM projects
            WHERE id = $1 AND deleted_at IS NULL
            LIMIT 1`,
          [projectIdParam],
        ) as Array<{ id: string; tenant_id: string; sps_workspace_id: string | null }>;
        proj = rows[0];
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[chat] project lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        return reply.status(500).send({ ok: false, error: 'project_lookup_failed' });
      }
      if (!proj) return reply.status(404).send({ ok: false, error: 'project_not_found' });
      if (proj.sps_workspace_id !== payload.sps_workspace_id) {
        return reply.status(403).send({ ok: false, error: 'workspace_mismatch' });
      }

      // 409 concurrency guard: if there's a running agent_run on this
      // project, reject. SPS's driver polls; it'll see agent_status
      // = 'idle' before retrying. `force_new_run` (round 14.2 unblock)
      // is the opt-out — caller asserts the previous run is wedged and
      // explicitly wants to replace it. We mark the stale run as
      // failed:replaced and proceed.
      let replacedRunId: string | null = null;
      if (body.trigger_agent) {
        try {
          const active = await sql.unsafe(
            `SELECT id, started_at FROM agent_runs
              WHERE project_id = $1 AND status = 'running'
              LIMIT 1`,
            [proj.id],
          ) as Array<{ id: string; started_at: string }>;
          if (active.length > 0) {
            if (body.force_new_run) {
              // Mark the stuck run as failed so the next read sees it
              // terminated and our new run can claim the project. Append
              // the replacement marker to `summary` so post-hoc audits
              // can correlate "why did this run die?".
              try {
                await sql.unsafe(
                  `UPDATE agent_runs
                      SET status   = 'failed',
                          ended_at = NOW(),
                          summary  = COALESCE(summary, '')
                                  || ' [replaced by force_new_run at '
                                  || NOW()::text || ']'
                    WHERE id = $1`,
                  [active[0]!.id],
                );
                replacedRunId = active[0]!.id;
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`[chat] force_new_run mark-failed failed: ${err instanceof Error ? err.message : String(err)}`);
                return reply.status(500).send({ ok: false, error: 'force_new_run_mark_failed' });
              }
            } else {
              return reply.status(409).send({
                ok:                     false,
                error:                  'agent_run_in_progress',
                current_run_id:         active[0]!.id,
                current_run_started_at: active[0]!.started_at,
              });
            }
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[chat] active-run lookup failed (non-fatal, proceeding): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Persist the user message.
      let messageId: string;
      let appendedAt: string;
      try {
        const inserted = await sql.unsafe(
          `INSERT INTO chat_messages (project_id, tenant_id, role, content, metadata)
           VALUES ($1, $2, 'user', $3, '{}'::jsonb)
           RETURNING id, created_at`,
          [proj.id, proj.tenant_id, body.content],
        ) as Array<{ id: string; created_at: string }>;
        messageId = inserted[0]!.id;
        appendedAt = inserted[0]!.created_at;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[chat] insert user message failed: ${msg}`);
        return reply.status(500).send({ ok: false, error: 'insert_failed' });
      }

      // Fire the agent if requested. Runs synchronously inside this
      // request so we can include the agent_run_id in the response.
      // The runner persists its own assistant + tool messages to
      // chat_messages so the SPS driver's GET poll sees them.
      let agentRunId: string | null = null;
      if (body.trigger_agent) {
        try {
          const result = await runChatTurn({
            projectId:        proj.id,
            newUserMessageId: messageId,
          });
          agentRunId = result.agentRunId;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[chat] runChatTurn threw (will return 200 with null run id): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Audit. Content hash only — chat content may carry customer info.
      // `force_new_run` + `replaced_run_id` recorded so post-hoc analysis
      // can correlate "operator-initiated replace" events with stuck-run
      // patterns over time.
      await writeAuditEvent({
        tenantId: proj.tenant_id,
        action:   'sps.project.chat',
        target:   'project',
        targetId: proj.id,
        env:      'production',
        after: {
          message_id:       messageId,
          sps_workspace_id: payload.sps_workspace_id,
          content_bytes:    body.content.length,
          trigger_agent:    body.trigger_agent,
          agent_run_id:     agentRunId,
          force_new_run:    body.force_new_run,
          ...(replacedRunId ? { replaced_run_id: replacedRunId } : {}),
        },
      }).catch(() => { /* best-effort */ });

      return reply.send({
        ok:           true,
        message_id:   messageId,
        appended_at:  appendedAt,
        agent_run_id: agentRunId,
        ...(replacedRunId ? { replaced_run_id: replacedRunId } : {}),
      });
    },
  );

  /**
   * GET /api/sps/projects/:projectId/chat?since=<iso8601>&limit=50
   *
   * Round 14 — SPS's build-driver poll endpoint. Returns chat
   * messages newer than the `since` cursor + current agent_status +
   * files_present count so the driver can detect "build complete."
   *
   * Auth: same `project-chat` scope as POST.
   *
   * Query params:
   *   since:  ISO8601 timestamp (optional; default = epoch zero = all messages)
   *   limit:  integer 1..200 (optional; default 50)
   *
   * 200:  { messages: [...], agent_status, current_run_id, files_present }
   * 400/401/403/404: same shapes as POST
   * 500:  internal_error
   */
  app.get<{
    Params:      { projectId: string };
    Querystring: { since?: string; limit?: string };
  }>(
    '/api/sps/projects/:projectId/chat',
    async (req, reply) => {
      const projectIdParam = (req.params as { projectId?: string }).projectId;
      if (!projectIdParam) {
        return reply.status(400).send({ ok: false, error: 'missing_project_id_path_param' });
      }

      const token = bearerFrom(req.headers.authorization);
      if (!token) return reply.status(401).send({ ok: false, error: 'missing_bearer_token' });

      let payload: HandoffPayload;
      try {
        payload = verifyHandoffToken(token, 'project-chat');
      } catch (err) {
        const reason = err instanceof HandoffTokenError ? err.reason : 'verification_failed';
        return reply.status(401).send({ ok: false, error: 'invalid_token', reason });
      }

      if (!payload.project_id) {
        return reply.status(400).send({ ok: false, error: 'missing_project_id_in_token' });
      }
      if (payload.project_id.toLowerCase() !== projectIdParam.toLowerCase()) {
        return reply.status(403).send({ ok: false, error: 'wrong_project' });
      }

      // Project lookup + workspace defense.
      const sql = getRawSql();
      let proj: { id: string; sps_workspace_id: string | null } | undefined;
      try {
        const rows = await sql.unsafe(
          `SELECT id, sps_workspace_id FROM projects
            WHERE id = $1 AND deleted_at IS NULL
            LIMIT 1`,
          [projectIdParam],
        ) as Array<{ id: string; sps_workspace_id: string | null }>;
        proj = rows[0];
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[chat-get] project lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        return reply.status(500).send({ ok: false, error: 'project_lookup_failed' });
      }
      if (!proj) return reply.status(404).send({ ok: false, error: 'project_not_found' });
      if (proj.sps_workspace_id !== payload.sps_workspace_id) {
        return reply.status(403).send({ ok: false, error: 'workspace_mismatch' });
      }

      // Parse query. since defaults to epoch zero, limit defaults to
      // 50, capped at 200.
      const since = req.query.since ?? '1970-01-01T00:00:00Z';
      const limitRaw = Number.parseInt(req.query.limit ?? '50', 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

      // Read messages since cursor.
      let messages: Array<{
        id:           string;
        role:         string;
        content:      string;
        tool_calls:   unknown;
        tool_call_id: string | null;
        agent_run_id: string | null;
        created_at:   string;
      }> = [];
      try {
        messages = await sql.unsafe(
          `SELECT id, role, content, tool_calls, tool_call_id, agent_run_id, created_at
             FROM chat_messages
            WHERE project_id = $1 AND created_at > $2::timestamptz
            ORDER BY created_at ASC
            LIMIT $3`,
          [proj.id, since, limit],
        ) as typeof messages;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[chat-get] message read failed: ${err instanceof Error ? err.message : String(err)}`);
        return reply.status(500).send({ ok: false, error: 'message_read_failed' });
      }

      // Agent status: most recent agent_run on this project.
      let agentStatus: string = 'idle';
      let currentRunId: string | null = null;
      try {
        const runRows = await sql.unsafe(
          `SELECT id, status FROM agent_runs
            WHERE project_id = $1
            ORDER BY started_at DESC NULLS LAST, created_at DESC
            LIMIT 1`,
          [proj.id],
        ) as Array<{ id: string; status: string }>;
        if (runRows[0]) {
          // Map agent_runs.status enum to the simple states SPS expects.
          const s = runRows[0].status;
          if (s === 'running') { agentStatus = 'running'; currentRunId = runRows[0].id; }
          else if (s === 'awaiting_approval' || s === 'blocked' || s === 'paused') {
            agentStatus = 'awaiting_input'; currentRunId = runRows[0].id;
          }
          else if (s === 'failed' || s === 'killed') { agentStatus = 'failed'; }
          else { agentStatus = 'idle'; }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[chat-get] agent_runs lookup failed (non-fatal, defaulting idle): ${err instanceof Error ? err.message : String(err)}`);
      }

      // files_present: count of files in the project's workspace files
      // table. The build-driver uses this as a cheap "did the agent
      // actually write anything yet" probe.
      let filesPresent = 0;
      try {
        const fileRows = await sql.unsafe(
          `SELECT COUNT(*)::int AS n FROM files
            WHERE project_id = $1 AND (deleted_at IS NULL OR deleted_at IS NULL)`,
          [proj.id],
        ) as Array<{ n: number }>;
        filesPresent = fileRows[0]?.n ?? 0;
      } catch {
        filesPresent = 0;
      }

      return reply.send({
        ok:              true,
        messages:        messages.map((m) => ({
          id:           m.id,
          role:         m.role,
          content:      m.content,
          tool_calls:   m.tool_calls,
          tool_call_id: m.tool_call_id,
          agent_run_id: m.agent_run_id,
          created_at:   m.created_at,
        })),
        agent_status:    agentStatus,
        current_run_id:  currentRunId,
        files_present:   filesPresent,
      });
    },
  );
}
