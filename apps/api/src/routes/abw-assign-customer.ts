// apps/api/src/routes/abw-assign-customer.ts — Round 8 Feature B endpoint.
//
// IDE-first customer creation with pending invoice. The agency rep is on a
// sales call, builds a demo site live in the ABW IDE, clicks "Assign to new
// customer" in the publish menu, fills a modal with prospect details, and
// hits Submit. This route is what the IDE calls.
//
// Flow (round 8 §B):
//   1. Session-authed (rep's user in their agency ABW tenant). Body carries
//      customer_email, contact_name, business_name, package_slug, niche_slug?,
//      project_id.
//   2. We mint a 60s HS256 S2S bearer with scope='assign-new-customer'.
//      Same shared `SPS_HANDOFF_KEY_<KID>` secret as the mint-site-config
//      direction; iss/aud/scope isolate the flows.
//   3. POST to SPS's `/api/abw/assign-to-new-customer` endpoint.
//   4. SPS creates organization + workspace + Stripe invoice + customer_websites
//      row in pending_payment state; emails the invoice to the customer;
//      returns { workspace_id, invoice_id, invoice_url, pending_until_iso }.
//   5. We persist the four pending-* columns on the ABW project record so
//      the IDE banner + publish-gate fire (migration 0015).
//   6. Return invoice details to the IDE. Modal closes, banner appears.
//
// Standalone-IDE guarantee: this route's effects are purely opt-in. Standalone
// projects never touch these columns. The publish-gate in publish.ts skips
// transparently for projects without pending_until set.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../security/authz';
import { getRawSql } from '../db/client';
import { writeAuditEvent } from '../security/audit';
import { env } from '../config/env';
import {
  mintAbwS2sToken,
  ASSIGN_NEW_CUSTOMER_SCOPE,
  SpsServiceTokenError,
} from '../security/spsServiceToken';

const AssignToNewCustomerBodySchema = z.object({
  project_id:     z.string().uuid(),
  customer_email: z.string().email().max(254),
  contact_name:   z.string().min(1).max(120),
  business_name:  z.string().min(1).max(120),
  package_slug:   z.string().min(1).max(60).regex(/^[a-z0-9_-]+$/i),
  niche_slug:     z.string().min(1).max(60).regex(/^[a-z0-9_-]+$/i).optional(),
});

/** SPS round-8 wave-8 response shape — Stripe Checkout Session flow.
 *  See SPS commit 7d81268 for the exact contract. SPS returns
 *  `payment_url` (Checkout Session URL) + `stripe_session_id`; NOT
 *  invoice fields (the original spec said "invoice" but SPS shipped
 *  Sessions because the invoice row doesn't exist until checkout
 *  completes — chicken-and-egg). */
const SpsResponseSchema = z.object({
  ok:                  z.literal(true),
  workspace_id:        z.string().uuid(),
  organization_id:     z.string().uuid(),
  customer_website_id: z.string().uuid(),
  payment_url:         z.string().url(),
  stripe_session_id:   z.string().min(1),
  pending_until:       z.string().datetime(),
});

export async function abwAssignCustomerRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/abw/assign-to-new-customer
   *
   * Session-authed. Wraps the SPS `/api/abw/assign-to-new-customer` endpoint:
   * mints the S2S bearer, forwards the body, persists the response on the
   * project row. On any SPS failure, returns the SPS reason transparently so
   * the IDE can show a useful error message.
   */
  app.post<{ Body: unknown }>(
    '/api/abw/assign-to-new-customer',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const ctx = req.authCtx!;
      // Same role gate as publish — only an authenticated rep on the agency
      // side should be able to provision a customer. Member is the floor.
      requireRole(ctx, 'member');

      const parsed = AssignToNewCustomerBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'bad_body', issues: parsed.error.format() });
      }
      const body = parsed.data;

      // Confirm the project belongs to this rep's tenant before we provision
      // a customer for it. Defends against an IDE bug that submits a wrong
      // project_id; SPS would otherwise create a real Stripe Checkout
      // Session tied to a project the rep doesn't own. We also need the
      // project's slug to forward to SPS (their endpoint requires both
      // project_id + project_slug).
      const sql = getRawSql();
      let project: { id: string; slug: string; pending_until: string | null } | undefined;
      try {
        const rows = await sql.unsafe(
          `SELECT id, slug, pending_until
             FROM projects
            WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
            LIMIT 1`,
          [body.project_id, ctx.tenantId],
        ) as Array<{ id: string; slug: string; pending_until: string | null }>;
        project = rows[0];
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[assign-customer] project lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        return reply.status(500).send({ error: 'project_lookup_failed' });
      }
      if (!project) return reply.status(404).send({ error: 'project_not_found_or_not_owned' });

      // Don't allow assigning twice — if a project is already pending payment,
      // operator should wait or expire the previous invoice first.
      if (project.pending_until && Date.parse(project.pending_until) > Date.now()) {
        return reply.status(409).send({
          error:   'already_pending_payment',
          message: 'This project is already pending an invoice. Wait for that one to be paid or expire before assigning again.',
        });
      }

      // Mint the S2S bearer. sps_workspace_id claim carries the rep's ABW
      // tenant id — there's no customer workspace yet (that's what we're
      // creating), so the claim doubles as "which agency tenant requested
      // this" for SPS audit. SPS verifier requires UUID format only.
      let bearer: string;
      try {
        bearer = mintAbwS2sToken({
          spsWorkspaceId: ctx.tenantId,
          scope:          ASSIGN_NEW_CUSTOMER_SCOPE,
        });
      } catch (err) {
        if (err instanceof SpsServiceTokenError) {
          // eslint-disable-next-line no-console
          console.warn(`[assign-customer] S2S mint failed: ${err.reason}`);
          return reply.status(500).send({ error: 'sps_handoff_not_configured', reason: err.reason });
        }
        return reply.status(500).send({ error: 'mint_failed' });
      }

      // Call SPS. Use the same SPS_API_BASE_URL env var as the mint-site-config
      // direction; defaults to the production SPS host.
      const url = `${env.SPS_API_BASE_URL.replace(/\/+$/, '')}/api/abw/assign-to-new-customer`;
      let spsRes: Response;
      try {
        spsRes = await fetch(url, {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${bearer}`,
            'Content-Type':  'application/json',
            'Accept':        'application/json',
          },
          body: JSON.stringify({
            // SPS round-8 wave-8 contract (commit 7d81268): project_id +
            // project_slug both required. project_id must be lowercase UUID.
            project_id:     body.project_id.toLowerCase(),
            project_slug:   project.slug,
            customer_email: body.customer_email,
            contact_name:   body.contact_name,
            business_name:  body.business_name,
            package_slug:   body.package_slug,
            niche_slug:     body.niche_slug ?? null,
          }),
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[assign-customer] SPS fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        return reply.status(502).send({ error: 'sps_unreachable' });
      }

      if (!spsRes.ok) {
        // Forward SPS's body so the IDE can show what went wrong (e.g.
        // unknown package_slug, invoice service down, etc.).
        let text = '';
        try { text = await spsRes.text(); } catch { /* ignore */ }
        // eslint-disable-next-line no-console
        console.warn(`[assign-customer] SPS returned ${spsRes.status} body=${text.slice(0, 300)}`);
        return reply.status(502).send({
          error:        'sps_rejected',
          sps_status:   spsRes.status,
          sps_body:     text.slice(0, 1000),
        });
      }

      let json: unknown;
      try {
        json = await spsRes.json();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[assign-customer] SPS body parse failed: ${err instanceof Error ? err.message : String(err)}`);
        return reply.status(502).send({ error: 'sps_body_unparseable' });
      }

      const parsedSps = SpsResponseSchema.safeParse(json);
      if (!parsedSps.success) {
        // eslint-disable-next-line no-console
        console.error(`[assign-customer] SPS response failed schema: ${parsedSps.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        return reply.status(502).send({ error: 'sps_schema_drift', issues: parsedSps.error.format() });
      }
      const r = parsedSps.data;

      // Persist pending-customer state on the project. Migration 0015 added
      // these four columns. If for some reason they don't exist yet (e.g.
      // migration didn't apply this boot), the update will fail loudly — we
      // surface that as 500 with a hint to the operator.
      //
      // Column naming mirrors SPS's `customer_websites` table (round-8 wave-8):
      // pending_stripe_session_id (Checkout Session id from Stripe) +
      // pending_payment_url (Stripe-hosted Checkout page).
      try {
        await sql.unsafe(
          `UPDATE projects
              SET pending_customer_email     = $1,
                  pending_stripe_session_id  = $2,
                  pending_payment_url        = $3,
                  pending_until              = $4,
                  updated_at                 = now()
            WHERE id = $5 AND tenant_id = $6 AND deleted_at IS NULL`,
          [body.customer_email, r.stripe_session_id, r.payment_url, r.pending_until, body.project_id, ctx.tenantId],
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[assign-customer] failed to persist pending state: ${msg}`);
        // SPS already created the Stripe session; we can't roll that back
        // from here. Surface so the operator can manually reconcile from
        // SPS admin (cancel session, retry assign).
        return reply.status(500).send({
          error:                'sps_ok_but_local_persist_failed',
          warning:              'Stripe session was created in SPS but ABW could not record pending-customer state. Reconcile from SPS admin.',
          sps_workspace_id:     r.workspace_id,
          sps_organization_id:  r.organization_id,
          sps_customer_website_id: r.customer_website_id,
          payment_url:          r.payment_url,
          stripe_session_id:    r.stripe_session_id,
        });
      }

      // Audit.
      await writeAuditEvent({
        tenantId: ctx.tenantId,
        action:   'abw.assign_to_new_customer',
        target:   'project',
        targetId: body.project_id,
        env:      'production',
        after:    {
          customer_email:      body.customer_email,
          business_name:       body.business_name,
          package_slug:        body.package_slug,
          sps_workspace_id:    r.workspace_id,
          sps_organization_id: r.organization_id,
          stripe_session_id:   r.stripe_session_id,
          pending_until:       r.pending_until,
        },
      }).catch(() => { /* best-effort */ });

      return reply.send({
        ok:                   true,
        workspace_id:         r.workspace_id,
        organization_id:      r.organization_id,
        customer_website_id:  r.customer_website_id,
        payment_url:          r.payment_url,
        stripe_session_id:    r.stripe_session_id,
        pending_until:        r.pending_until,
      });
    },
  );
}
