// apps/api/src/routes/higgsfield.ts — Higgsfield OAuth + MCP connection management.
//
// Endpoints:
//   POST   /api/higgsfield/oauth/start     — auth-required; returns the authorization URL
//   GET    /api/higgsfield/oauth/callback  — public; Higgsfield redirects here with code+state
//   GET    /api/higgsfield/status          — auth-required; { connected, ... }
//   POST   /api/higgsfield/test            — auth-required; round-trips tools/list
//   DELETE /api/higgsfield/connection      — auth-required; clears stored tokens
//
// Flow:
//   1. UI clicks Connect → POST /oauth/start → server runs SDK auth()
//      orchestrator (DCR + PKCE). Server captures the authorization URL via
//      the OAuthClientProvider's redirectToAuthorization() and returns it.
//   2. UI opens that URL in a new tab/popup. User signs in to Higgsfield.
//   3. Higgsfield redirects to /api/higgsfield/oauth/callback?code=...&state=...
//   4. Callback exchanges code for tokens via auth({ authorizationCode }).
//      Tokens land in the vault (HIGGSFIELD_OAUTH_TOKENS, per tenant).
//   5. Callback returns a tiny HTML page that posts a message to window.opener
//      and self-closes. UI reloads /status.
//
// Security notes:
//   - The callback is unauthenticated (Higgsfield can't carry our session cookie),
//     but we trust the in-memory `state` map (10-min TTL) to bind the code back
//     to the correct tenant. State values are random UUIDs.
//   - Tokens never leave the server after exchange. The UI only sees connected/not.

import type { FastifyInstance } from 'fastify';
import { authMiddleware, type AuthContext } from '../security/authz';
import { writeAuditEvent } from '../security/audit';
import {
  beginHiggsfieldAuth,
  finishHiggsfieldAuth,
  openHiggsfield,
  isHiggsfieldConnected,
  clearHiggsfieldVault,
  categorizeHiggsfieldTools,
} from '../providers/higgsfield';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

export async function higgsfieldRoutes(app: FastifyInstance): Promise<void> {
  // Public callback — must be reachable WITHOUT auth (Higgsfield doesn't carry our session).
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/api/higgsfield/oauth/callback',
    async (req, reply) => {
      const { code, state, error, error_description } = req.query;

      if (error) {
        return reply
          .type('text/html')
          .send(callbackHtml({
            ok: false,
            message: `Higgsfield rejected the connection: ${error}${error_description ? ' — ' + error_description : ''}`,
          }));
      }

      if (!code || !state) {
        return reply.type('text/html').status(400).send(callbackHtml({
          ok: false,
          message: 'Missing code or state in OAuth callback.',
        }));
      }

      try {
        const { tenantId } = await finishHiggsfieldAuth(state, code);
        await writeAuditEvent({
          tenantId,
          action:   'integration.connect',
          target:   'higgsfield',
          env:      'dev',
          ip:       req.ip,
          ua:       req.headers['user-agent'] ?? '',
        });
        return reply.type('text/html').send(callbackHtml({
          ok: true,
          message: 'Connected to Higgsfield. You can close this window.',
        }));
      } catch (err) {
        return reply.type('text/html').status(500).send(callbackHtml({
          ok: false,
          message: `Token exchange failed: ${(err as Error).message}`,
        }));
      }
    },
  );

  // All other routes require auth.
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/higgsfield/oauth/callback')) return;
    await authMiddleware(req, reply);
  });

  /** POST /api/higgsfield/oauth/start — kick off the OAuth dance. */
  app.post('/api/higgsfield/oauth/start', async (req, reply) => {
    const ctx = req.authCtx!;
    try {
      const { state, authUrl } = await beginHiggsfieldAuth(ctx.tenantId, 'dev', ctx.userId);
      if (!authUrl) {
        // Already authorized — no redirect needed.
        return { authorized: true, state };
      }
      return { authorized: false, state, authUrl };
    } catch (err) {
      const msg  = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 6).join('\n') : undefined;
      // Log to API console (visible in Coolify / .exe log) so we can debug auth issues.
      req.log.error({ err: msg, stack }, 'Higgsfield OAuth start failed');
      return reply.status(502).send({ error: msg, hint: stack });
    }
  });

  /** GET /api/higgsfield/status — is the tenant connected? */
  app.get('/api/higgsfield/status', async (req) => {
    const ctx = req.authCtx!;
    const connected = await isHiggsfieldConnected(ctx.tenantId, 'dev');
    return { connected };
  });

  /** POST /api/higgsfield/test — listTools roundtrip + tool categorisation. */
  app.post('/api/higgsfield/test', async (req, reply) => {
    const ctx = req.authCtx!;
    try {
      const c = await openHiggsfield(ctx.tenantId, 'dev');
      const tools = await c.listTools();
      await c.close();
      const cats = categorizeHiggsfieldTools(tools);
      return {
        ok:        true,
        toolCount: tools.length,
        categories: {
          images:     cats.images.length,
          videos:     cats.videos.length,
          audio:      cats.audio.length,
          characters: cats.characters.length,
          history:    cats.history.length,
        },
        sample: tools.slice(0, 8).map((t) => ({ name: t.name, description: t.description?.slice(0, 200) })),
      };
    } catch (err) {
      return reply.status(502).send({ ok: false, error: (err as Error).message });
    }
  });

  /** DELETE /api/higgsfield/connection — disconnect, clear vault. */
  app.delete('/api/higgsfield/connection', async (req, reply) => {
    const ctx = req.authCtx!;
    try {
      await clearHiggsfieldVault(ctx.tenantId, 'dev');
      await writeAuditEvent({
        actor: ctx.userId, tenantId: ctx.tenantId,
        action: 'integration.disconnect', target: 'higgsfield',
        env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
      });
      return reply.status(204).send();
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
}

// ── Tiny HTML page returned to the popup after callback ─────────────────────

function callbackHtml(opts: { ok: boolean; message: string }): string {
  const color = opts.ok ? '#16a34a' : '#dc2626';
  const icon  = opts.ok ? '✓' : '✗';
  // Posts a message to the opener (the integrations screen) so it can refresh
  // status + close the popup, even before the user clicks anything.
  return `<!DOCTYPE html><html><head><title>Higgsfield · ${opts.ok ? 'Connected' : 'Failed'}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
         background: #fafafa; color: #18181b; margin: 0; min-height: 100vh;
         display: flex; align-items: center; justify-content: center; padding: 32px; }
  .card { max-width: 420px; background: #fff; border: 1px solid #e4e4e7;
          border-radius: 12px; padding: 32px; text-align: center;
          box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
  .icon { font-size: 48px; color: ${color}; line-height: 1; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; color: #52525b; margin: 0; line-height: 1.5; }
  .hint { font-size: 12px; color: #71717a; margin-top: 16px; }
</style></head><body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>${opts.ok ? 'Connected to Higgsfield' : 'Connection failed'}</h1>
  <p>${escapeHtml(opts.message)}</p>
  <p class="hint">This window will close automatically.</p>
</div>
<script>
  try { window.opener && window.opener.postMessage({ source: 'abw-higgsfield-oauth', ok: ${opts.ok ? 'true' : 'false'} }, '*'); } catch (e) {}
  setTimeout(() => { try { window.close(); } catch (e) {} }, ${opts.ok ? 1500 : 4000});
</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
