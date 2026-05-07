// apps/api/src/routes/cloudflare.ts — auth-gated proxy for the small set of
// Cloudflare API endpoints the deploy + custom-domain flow needs.
//
// Why proxy instead of calling CF from the browser:
//   • The CF_API_TOKEN never leaves the server (security).
//   • Per-tenant token storage can be added later without changing the
//     frontend contract.
//   • We can normalise / cap response shapes for the picker UI.
//
// Endpoints (all require platform admin auth):
//   GET  /api/cf/zones                    → list user's zones
//   GET  /api/cf/account                  → CF account id (echo of env)
//   GET  /api/cf/zones/:id/dns_records    → list records on one zone
//   POST /api/cf/zones/:id/dns_records    → create CNAME (used internally
//                                            by deploy; exposed for debug)
//   GET  /api/cf/registrar/domains        → list owned-via-CF domains
//                                            (best-effort; many tokens
//                                            won't have the scope)
//
// All call cfFetch from @abw/publish so auth/error-handling stays in one
// place. If the platform CF_API_TOKEN is missing, every endpoint returns
// 422 with a clear "configure CF_API_TOKEN" message.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { cfFetch } from '@abw/publish';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

interface CfZone {
  id:     string;
  name:   string;
  status: string;
  paused: boolean;
  type:   string;
  account?: { id: string; name: string };
}

interface CfDnsRecord {
  id:        string;
  name:      string;
  type:      string;
  content:   string;
  ttl:       number;
  proxied:   boolean;
  zone_name: string;
}

const CreateDnsRecordSchema = z.object({
  type:    z.enum(['A', 'AAAA', 'CNAME', 'TXT']),
  name:    z.string().min(1).max(253),
  content: z.string().min(1).max(255),
  ttl:     z.number().int().min(1).max(86400).default(1),
  proxied: z.boolean().default(true),
});

function tokenOrError(): { token: string; accountId: string } | { error: string } {
  const token     = process.env['CF_API_TOKEN'];
  const accountId = process.env['CF_ACCOUNT_ID'];
  if (!token) return { error: 'CF_API_TOKEN not configured on the server. Set it in Env & Secrets.' };
  if (!accountId) return { error: 'CF_ACCOUNT_ID not configured on the server. Set it in Env & Secrets.' };
  return { token, accountId };
}

export async function cloudflareRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** GET /api/cf/account — echo of the CF account id used for proxying.
   *  Used by the picker so it can build registrar deep-links. */
  app.get('/api/cf/account', async (req, reply) => {
    requireRole(req.authCtx!, 'member');
    const cfg = tokenOrError();
    if ('error' in cfg) return reply.status(422).send({ error: cfg.error });
    return { accountId: cfg.accountId };
  });

  /** GET /api/cf/zones — list zones the platform token can see.
   *  Returns up to 50 zones (CF's max per-page); pagination is overkill
   *  for typical solo accounts. */
  app.get('/api/cf/zones', async (req, reply) => {
    requireRole(req.authCtx!, 'member');
    const cfg = tokenOrError();
    if ('error' in cfg) return reply.status(422).send({ error: cfg.error });
    try {
      const zones = await cfFetch<CfZone[]>(`/zones?per_page=50`, cfg.token);
      return {
        zones: zones.map((z) => ({
          id:     z.id,
          name:   z.name,
          status: z.status,
          paused: z.paused,
          type:   z.type,
        })),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // CF token-scope errors are common — surface them clearly so the picker
      // can show the help text rather than a generic 500
      const isScope = /not authorized|insufficient|forbidden|read access/i.test(msg);
      return reply.status(isScope ? 403 : 502).send({
        error:    'Cloudflare zones lookup failed',
        detail:   msg,
        helpHint: isScope
          ? 'Your CF_API_TOKEN needs Zone:Read scope. Update it at https://dash.cloudflare.com/profile/api-tokens.'
          : undefined,
      });
    }
  });

  /** GET /api/cf/zones/:id/dns_records — list records on a zone.
   *  Useful for the picker to show "this CNAME already exists" hints. */
  app.get<{ Params: { id: string }; Querystring: { name?: string; type?: string } }>(
    '/api/cf/zones/:id/dns_records',
    async (req, reply) => {
      requireRole(req.authCtx!, 'member');
      const cfg = tokenOrError();
      if ('error' in cfg) return reply.status(422).send({ error: cfg.error });
      try {
        const params = new URLSearchParams();
        if (req.query.name) params.set('name', req.query.name);
        if (req.query.type) params.set('type', req.query.type);
        params.set('per_page', '50');
        const recs = await cfFetch<CfDnsRecord[]>(
          `/zones/${req.params.id}/dns_records?${params.toString()}`,
          cfg.token,
        );
        return { records: recs };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ error: 'Cloudflare dns_records lookup failed', detail: msg });
      }
    },
  );

  /** POST /api/cf/zones/:id/dns_records — create a record. Mostly used
   *  internally by the deploy handler; exposed here for manual debug
   *  workflows. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/cf/zones/:id/dns_records',
    async (req, reply) => {
      requireRole(req.authCtx!, 'admin');
      const cfg = tokenOrError();
      if ('error' in cfg) return reply.status(422).send({ error: cfg.error });
      const parsed = CreateDnsRecordSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

      try {
        const created = await cfFetch<CfDnsRecord>(
          `/zones/${req.params.id}/dns_records`,
          cfg.token,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(parsed.data),
          },
        );
        return { record: created };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 81057 / 81058 are CF's "record already exists" errors — surface
        // a clean 409 so callers can treat it as "already attached"
        const isConflict = /already exists|81057|81058/i.test(msg);
        return reply.status(isConflict ? 409 : 502).send({
          error:  isConflict ? 'DNS record already exists for this name' : 'Cloudflare dns_records create failed',
          detail: msg,
        });
      }
    },
  );

  /** GET /api/cf/registrar/domains — list domains the user has registered
   *  through Cloudflare Registrar. Best-effort; if the token doesn't have
   *  the scope, returns 200 with an empty list + helpHint so the picker
   *  can degrade gracefully (the deep-link to dash.cloudflare.com still
   *  works). */
  app.get('/api/cf/registrar/domains', async (req, reply) => {
    requireRole(req.authCtx!, 'member');
    const cfg = tokenOrError();
    if ('error' in cfg) return reply.status(422).send({ error: cfg.error });
    try {
      const domains = await cfFetch<unknown[]>(
        `/accounts/${cfg.accountId}/registrar/domains`,
        cfg.token,
      );
      return { domains };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.send({
        domains:  [],
        helpHint: `Could not list CF Registrar domains: ${msg}. The "Buy a domain" deep-link still works.`,
      });
    }
  });
}
