// apps/api/src/routes/email.ts — Email Composer + send-test via Resend/SendGrid.
// compose: single AI call → JSON { subject, previewText, bodyHtml } → buildEmailHtml().
// send-test: fetch vault key → POST to provider API.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, type AuthContext } from '../security/authz';
import { createMinimaxAdapter } from '../providers/minimax';
import { createOllamaAdapter }  from '../providers/ollama';
import { env } from '../config/env';
import { buildEmailHtml, type EmailStyle } from '../lib/emailRenderer';
import { vaultGet } from '../security/vault';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const EMAIL_STYLES = ['newsletter', 'welcome', 'promotional', 'transactional', 'announcement'] as const;

const ComposeBody = z.object({
  prompt:   z.string().min(1),
  style:    z.enum(EMAIL_STYLES).default('newsletter'),
  fromName: z.string().optional(),
  footer:   z.string().optional(),
  provider: z.string().default('minimax'),
  model:    z.string().default('MiniMax-M2.7'),
});

const SendTestBody = z.object({
  // Accept either `to` (canonical) or `toEmail` (legacy client field)
  to:       z.string().email().optional(),
  subject:  z.string().min(1),
  html:     z.string().min(1),
  fromName: z.string().optional(),
  provider:    z.enum(['resend', 'sendgrid']).optional(),
  toEmail:     z.string().email().optional(),
  fromEmail:   z.string().email().optional(),
  previewText: z.string().optional(),
}).refine((d) => !!(d.to ?? d.toEmail), {
  message: 'Either "to" or "toEmail" is required',
  path:    ['to'],
});

function stripFences(text: string): string {
  return text.replace(/^```(?:json|javascript|js|)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function composePrompt(userPrompt: string, style: EmailStyle): string {
  const styleGuide: Record<EmailStyle, string> = {
    newsletter:    'Informative, warm, editorial tone. Lead with insight, not self-promotion.',
    welcome:       'Friendly, clear, helpful. Set expectations and name the next step.',
    promotional:   'Punchy, benefit-first, with one clear call to action.',
    transactional: 'Terse, factual, no marketing. Confirm what happened and what to do next.',
    announcement:  'Confident, ceremonial, concise. Bury details; lead with the news.',
  };
  return [
    `Compose a ${style} email.`,
    `Brief: ${userPrompt}`,
    `Tone guide: ${styleGuide[style]}`,
    ``,
    `Return ONLY JSON in exactly this shape:`,
    `{`,
    `  "subject": "string (under 60 chars)",`,
    `  "previewText": "string (under 120 chars)",`,
    `  "bodyHtml": "string — ONLY these tags allowed: <p><h2><h3><ul><li><strong><em><a>. No divs, no classes, no inline styles."`,
    `}`,
    ``,
    `No markdown, no commentary — JSON only.`,
  ].join('\n');
}

/** Strip any non-whitelisted tags. Called on AI output to defend against broken instructions. */
function sanitizeBody(html: string): string {
  // Allow only these tags; strip everything else but keep text content.
  return html
    .replace(/<(?!\/?(p|h2|h3|ul|li|strong|em|a)\b)[^>]*>/gi, '')
    .replace(/\s(on\w+|style|class|id)="[^"]*"/gi, '')
    .replace(/\s(on\w+|style|class|id)='[^']*'/gi, '');
}

export async function emailRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── Compose (standard JSON, not SSE — fast enough) ───────────────────────
  app.post<{ Body: unknown }>('/api/email/compose', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = ComposeBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    const body = parsed.data;

    const adapter = body.provider === 'ollama'
      ? createOllamaAdapter(env.OLLAMA_BASE_URL)
      : createMinimaxAdapter(ctx.tenantId, 'dev');

    try {
      const res = await adapter.complete({
        prompt:      composePrompt(body.prompt, body.style as EmailStyle),
        model:       body.model,
        maxTokens:   2048,
        temperature: 0.75,
      });
      const parsedJson = JSON.parse(stripFences(String(res.text ?? ''))) as {
        subject?: string; previewText?: string; bodyHtml?: string;
      };
      const subject     = String(parsedJson.subject     ?? 'Untitled');
      const previewText = String(parsedJson.previewText ?? '');
      const bodyHtml    = sanitizeBody(String(parsedJson.bodyHtml ?? '<p>Empty email.</p>'));

      const fullHtml = buildEmailHtml({
        style:       body.style as EmailStyle,
        subject,
        previewText,
        bodyHtml,
        ...(body.fromName ? { fromName: body.fromName } : {}),
        ...(body.footer   ? { footer:   body.footer   } : {}),
      });

      return { subject, previewText, bodyHtml, fullHtml };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Compose failed' });
    }
  });

  // ── Send test ────────────────────────────────────────────────────────────
  // Tries Resend first, falls back to SendGrid automatically.
  app.post<{ Body: unknown }>('/api/email/send-test', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = SendTestBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    const body = parsed.data;

    // Normalise: support both new { to } and legacy { toEmail } fields
    const toAddr   = body.to ?? body.toEmail ?? '';
    const fromAddr = 'onboarding@resend.dev';
    const fromName = body.fromName ?? 'AI Builder Workspace';
    const fromFull = `${fromName} <${fromAddr}>`;

    try {
      // ── Try Resend first ────────────────────────────────────────────────
      let resendKey: string | null = null;
      try {
        resendKey = await vaultGet({ name: 'INTEGRATION_RESEND_DEV', env: 'dev', tenantId: ctx.tenantId });
      } catch { /* not configured — fall through */ }

      if (resendKey) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({ from: fromFull, to: [toAddr], subject: body.subject, html: body.html }),
          signal: AbortSignal.timeout(15_000),
        });
        if (r.ok) {
          const json = await r.json() as { id?: string };
          return { ok: true, provider: 'resend', messageId: json.id ?? null };
        }
        // Non-2xx from Resend — fall through to SendGrid
      }

      // ── Fall back to SendGrid ────────────────────────────────────────────
      let sgKey: string | null = null;
      try {
        sgKey = await vaultGet({ name: 'INTEGRATION_SENDGRID_DEV', env: 'dev', tenantId: ctx.tenantId });
      } catch { /* not configured */ }

      if (!sgKey) {
        return reply.status(400).send({
          error: 'No email provider configured. Connect Resend or SendGrid at /integrations.',
        });
      }

      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sgKey}` },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: toAddr }] }],
          from:             { email: fromAddr, name: fromName },
          subject:          body.subject,
          content:          [{ type: 'text/html', value: body.html }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok && r.status !== 202) {
        const detail = await r.text().catch(() => '');
        return reply.status(502).send({ error: `SendGrid error (${r.status}): ${detail}` });
      }
      return { ok: true, provider: 'sendgrid', messageId: r.headers.get('x-message-id') };

    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Send failed' });
    }
  });
}
