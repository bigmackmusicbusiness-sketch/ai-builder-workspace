// apps/api/src/routes/documents.ts — Document Studio (proposals, case studies, invoices, etc.).
// 5 types: business_proposal | case_study | project_report | invoice | pitch_deck.
// Invoices render directly from structured inputs (no AI call).
// Others use a single AI completion → structured JSON → HTML → PDF.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, type AuthContext } from '../security/authz';
import { getDb } from '../db/client';
import { documents, assets } from '@abw/db';
import { eq, and, desc } from 'drizzle-orm';
import { createMinimaxAdapter } from '../providers/minimax';
import { createOllamaAdapter }  from '../providers/ollama';
import { env } from '../config/env';
import { renderHtmlToPdf } from '../lib/pdf';
import { uploadBufferAsAsset } from '../lib/assetUpload';

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

const DOC_TYPES = ['business_proposal', 'case_study', 'project_report', 'invoice', 'pitch_deck'] as const;
type DocType = typeof DOC_TYPES[number];

const LineItemSchema = z.object({
  description: z.string(),
  qty:         z.number(),
  unitPrice:   z.number(),
});

const GenerateBody = z.object({
  title:       z.string().min(1),
  docType:     z.enum(DOC_TYPES),
  topic:       z.string().optional(),
  clientName:  z.string().optional(),
  companyName: z.string().optional(),
  // invoice fields
  lineItems:   z.array(LineItemSchema).optional(),
  currency:    z.string().default('USD'),
  projectId:   z.string().uuid().optional(),
  provider:    z.string().default('minimax'),
  model:       z.string().default('MiniMax-M2.7'),
  // legacy compat
  prompt:      z.string().optional(),
  invoice:     z.object({
    from:    z.object({ name: z.string(), email: z.string().optional(), address: z.string().optional() }),
    to:      z.object({ name: z.string(), email: z.string().optional(), address: z.string().optional() }),
    number:  z.string().default('INV-001'),
    date:    z.string().optional(),
    dueDate: z.string().optional(),
    items:   z.array(z.object({
      description: z.string(),
      quantity:    z.number().min(0),
      unitPrice:   z.number().min(0),
    })).min(1),
    taxPct:  z.number().min(0).max(100).default(0),
    notes:   z.string().optional(),
    currency: z.string().default('USD'),
  }).optional(),
});

// ── AI prompts per doc type ───────────────────────────────────────────────────

type GenerateInput = ReturnType<typeof GenerateBody.parse>;

function buildContextLine(input: GenerateInput): string {
  return [
    input.topic       ? `Topic: ${input.topic}` : '',
    input.clientName  ? `Client: ${input.clientName}` : '',
    input.companyName ? `Company: ${input.companyName}` : '',
    input.prompt      ? `Brief: ${input.prompt}` : '',
  ].filter(Boolean).join('\n');
}

function structuredPrompt(docType: DocType, userPrompt: string, title: string): string {
  switch (docType) {
    case 'business_proposal':
      return [
        `Write a business proposal titled "${title}".`,
        `Context: ${userPrompt}`,
        ``,
        `Return ONLY JSON in this shape:`,
        `{`,
        `  "coverTagline": "string",`,
        `  "executiveSummary": "2-3 paragraphs",`,
        `  "sections": [{ "heading": "string", "body": "multi-paragraph string" }],`,
        `  "deliverables": ["string"],`,
        `  "timeline": [{ "phase": "string", "duration": "string", "outcome": "string" }],`,
        `  "investment": { "total": "string", "breakdown": [{ "item": "string", "cost": "string" }] },`,
        `  "nextSteps": "string"`,
        `}`,
        `No markdown, no commentary — JSON only.`,
      ].join('\n');
    case 'case_study':
      return [
        `Write a case study titled "${title}".`,
        `Context: ${userPrompt}`,
        ``,
        `Return ONLY JSON:`,
        `{`,
        `  "client": "string",`,
        `  "industry": "string",`,
        `  "challenge": "1-2 paragraphs",`,
        `  "approach": "2-3 paragraphs",`,
        `  "solution": "2-3 paragraphs",`,
        `  "results": [{ "metric": "string", "value": "string", "context": "string" }],`,
        `  "quote": { "text": "string", "attribution": "string" }`,
        `}`,
      ].join('\n');
    case 'project_report':
      return [
        `Write a project report titled "${title}".`,
        `Context: ${userPrompt}`,
        ``,
        `Return ONLY JSON:`,
        `{`,
        `  "summary": "1-2 paragraphs",`,
        `  "objectives": ["string"],`,
        `  "progress": [{ "milestone": "string", "status": "on_track|at_risk|blocked|complete", "notes": "string" }],`,
        `  "risks": [{ "risk": "string", "mitigation": "string" }],`,
        `  "nextActions": ["string"]`,
        `}`,
      ].join('\n');
    case 'pitch_deck':
      return [
        `Build a pitch deck titled "${title}".`,
        `Context: ${userPrompt}`,
        ``,
        `Return ONLY JSON. Each slide = one PDF page.`,
        `{`,
        `  "slides": [`,
        `    { "kind": "title",     "title": "string", "subtitle": "string" },`,
        `    { "kind": "problem",   "title": "string", "body": "string" },`,
        `    { "kind": "solution",  "title": "string", "body": "string" },`,
        `    { "kind": "market",    "title": "string", "body": "string", "stats": [{ "label": "string", "value": "string" }] },`,
        `    { "kind": "product",   "title": "string", "body": "string" },`,
        `    { "kind": "traction",  "title": "string", "body": "string", "stats": [{ "label": "string", "value": "string" }] },`,
        `    { "kind": "team",      "title": "string", "members": [{ "name": "string", "role": "string", "bio": "string" }] },`,
        `    { "kind": "ask",       "title": "string", "body": "string" }`,
        `  ]`,
        `}`,
        `Produce 8–12 slides total. No markdown — JSON only.`,
      ].join('\n');
    default:
      return `Write ${title}. Context: ${userPrompt}. Return JSON with "sections": [{ "heading": "string", "body": "string" }].`;
  }
}

// ── HTML builders ─────────────────────────────────────────────────────────────

const BASE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Sans+Pro:wght@400;600;700&display=swap');
  * { box-sizing: border-box; }
  body { font-family: 'Source Sans Pro', sans-serif; color: #1a1a2e; line-height: 1.6; margin: 0; padding: 48px 56px; font-size: 11pt; }
  h1 { font-family: 'Inter', sans-serif; font-size: 28pt; margin: 0 0 8px; font-weight: 700; letter-spacing: -0.02em; }
  h2 { font-family: 'Inter', sans-serif; font-size: 16pt; margin: 32px 0 12px; font-weight: 600; color: #1a1a2e; border-bottom: 2px solid #6c63ff; padding-bottom: 6px; }
  h3 { font-size: 12pt; margin: 20px 0 8px; font-weight: 600; }
  p  { margin: 0 0 12px; }
  ul, ol { margin: 0 0 12px 20px; }
  .cover { text-align: center; padding: 80px 0 40px; border-bottom: 1px solid #ddd; margin-bottom: 40px; }
  .tagline { font-size: 14pt; color: #6c63ff; font-style: italic; margin-top: 12px; }
  .meta { font-size: 9pt; color: #666; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #eee; }
  th { background: #f7f7fb; font-weight: 600; font-size: 10pt; }
  .kpi-grid { display: flex; gap: 16px; margin: 16px 0; flex-wrap: wrap; }
  .kpi { background: #f7f7fb; padding: 14px 18px; border-radius: 8px; min-width: 160px; }
  .kpi-value { font-size: 18pt; font-weight: 700; color: #6c63ff; }
  .kpi-label { font-size: 9pt; color: #666; margin-top: 4px; }
  .slide { min-height: 720px; page-break-after: always; padding: 40px 20px; }
  .slide-title { text-align: center; padding-top: 280px; }
  .slide-title h1 { font-size: 40pt; }
  .quote { font-size: 14pt; font-style: italic; padding: 20px 30px; border-left: 4px solid #6c63ff; margin: 24px 0; color: #444; }
  .quote-attr { font-style: normal; font-size: 10pt; color: #888; margin-top: 8px; }
`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

function wrap(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${BASE_CSS}</style></head><body>${body}</body></html>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProposalHtml(title: string, data: any): string {
  const body = `
    <div class="cover">
      <h1>${escapeHtml(title)}</h1>
      ${data.coverTagline ? `<div class="tagline">${escapeHtml(String(data.coverTagline))}</div>` : ''}
      <div class="meta">Proposal · ${new Date().toLocaleDateString()}</div>
    </div>
    <h2>Executive Summary</h2>
    <p>${escapeHtml(String(data.executiveSummary ?? '')).replace(/\n\n/g, '</p><p>')}</p>
    ${(Array.isArray(data.sections) ? data.sections : []).map((s: { heading?: string; body?: string }) => `
      <h2>${escapeHtml(String(s.heading ?? ''))}</h2>
      <p>${escapeHtml(String(s.body ?? '')).replace(/\n\n/g, '</p><p>')}</p>
    `).join('')}
    ${Array.isArray(data.deliverables) && data.deliverables.length ? `
      <h2>Deliverables</h2>
      <ul>${data.deliverables.map((d: string) => `<li>${escapeHtml(String(d))}</li>`).join('')}</ul>
    ` : ''}
    ${Array.isArray(data.timeline) && data.timeline.length ? `
      <h2>Timeline</h2>
      <table>
        <thead><tr><th>Phase</th><th>Duration</th><th>Outcome</th></tr></thead>
        <tbody>
          ${data.timeline.map((p: { phase?: string; duration?: string; outcome?: string }) => `
            <tr><td>${escapeHtml(String(p.phase ?? ''))}</td><td>${escapeHtml(String(p.duration ?? ''))}</td><td>${escapeHtml(String(p.outcome ?? ''))}</td></tr>
          `).join('')}
        </tbody>
      </table>
    ` : ''}
    ${data.investment ? `
      <h2>Investment</h2>
      <table>
        <thead><tr><th>Item</th><th style="text-align:right">Cost</th></tr></thead>
        <tbody>
          ${(data.investment.breakdown ?? []).map((b: { item?: string; cost?: string }) => `
            <tr><td>${escapeHtml(String(b.item ?? ''))}</td><td style="text-align:right">${escapeHtml(String(b.cost ?? ''))}</td></tr>
          `).join('')}
          <tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${escapeHtml(String(data.investment.total ?? ''))}</strong></td></tr>
        </tbody>
      </table>
    ` : ''}
    ${data.nextSteps ? `
      <h2>Next Steps</h2>
      <p>${escapeHtml(String(data.nextSteps))}</p>
    ` : ''}
  `;
  return wrap(title, body);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCaseStudyHtml(title: string, data: any): string {
  const body = `
    <div class="cover">
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${escapeHtml(String(data.client ?? ''))} · ${escapeHtml(String(data.industry ?? ''))}</div>
    </div>
    <h2>Challenge</h2>
    <p>${escapeHtml(String(data.challenge ?? '')).replace(/\n\n/g, '</p><p>')}</p>
    <h2>Approach</h2>
    <p>${escapeHtml(String(data.approach ?? '')).replace(/\n\n/g, '</p><p>')}</p>
    <h2>Solution</h2>
    <p>${escapeHtml(String(data.solution ?? '')).replace(/\n\n/g, '</p><p>')}</p>
    ${Array.isArray(data.results) && data.results.length ? `
      <h2>Results</h2>
      <div class="kpi-grid">
        ${data.results.map((r: { metric?: string; value?: string; context?: string }) => `
          <div class="kpi">
            <div class="kpi-value">${escapeHtml(String(r.value ?? ''))}</div>
            <div class="kpi-label">${escapeHtml(String(r.metric ?? ''))}</div>
            ${r.context ? `<div class="kpi-label" style="margin-top:6px">${escapeHtml(String(r.context))}</div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${data.quote ? `
      <div class="quote">
        "${escapeHtml(String(data.quote.text ?? ''))}"
        <div class="quote-attr">— ${escapeHtml(String(data.quote.attribution ?? ''))}</div>
      </div>
    ` : ''}
  `;
  return wrap(title, body);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildReportHtml(title: string, data: any): string {
  const body = `
    <div class="cover">
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">Project Report · ${new Date().toLocaleDateString()}</div>
    </div>
    <h2>Summary</h2>
    <p>${escapeHtml(String(data.summary ?? '')).replace(/\n\n/g, '</p><p>')}</p>
    ${Array.isArray(data.objectives) && data.objectives.length ? `
      <h2>Objectives</h2>
      <ul>${data.objectives.map((o: string) => `<li>${escapeHtml(String(o))}</li>`).join('')}</ul>
    ` : ''}
    ${Array.isArray(data.progress) && data.progress.length ? `
      <h2>Progress</h2>
      <table>
        <thead><tr><th>Milestone</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${data.progress.map((p: { milestone?: string; status?: string; notes?: string }) => `
            <tr><td>${escapeHtml(String(p.milestone ?? ''))}</td><td>${escapeHtml(String(p.status ?? ''))}</td><td>${escapeHtml(String(p.notes ?? ''))}</td></tr>
          `).join('')}
        </tbody>
      </table>
    ` : ''}
    ${Array.isArray(data.risks) && data.risks.length ? `
      <h2>Risks &amp; Mitigations</h2>
      <ul>
        ${data.risks.map((r: { risk?: string; mitigation?: string }) => `
          <li><strong>${escapeHtml(String(r.risk ?? ''))}</strong> — ${escapeHtml(String(r.mitigation ?? ''))}</li>
        `).join('')}
      </ul>
    ` : ''}
    ${Array.isArray(data.nextActions) && data.nextActions.length ? `
      <h2>Next Actions</h2>
      <ul>${data.nextActions.map((a: string) => `<li>${escapeHtml(String(a))}</li>`).join('')}</ul>
    ` : ''}
  `;
  return wrap(title, body);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPitchDeckHtml(title: string, data: any): string {
  const slides = Array.isArray(data.slides) ? data.slides : [];
  const body = slides.map((s: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kind?: string; title?: string; subtitle?: string; body?: string; stats?: any[]; members?: any[];
  }) => {
    if (s.kind === 'title') {
      return `<div class="slide slide-title">
        <h1>${escapeHtml(String(s.title ?? title))}</h1>
        ${s.subtitle ? `<div class="tagline">${escapeHtml(String(s.subtitle))}</div>` : ''}
      </div>`;
    }
    if (s.kind === 'team' && Array.isArray(s.members)) {
      return `<div class="slide">
        <h2>${escapeHtml(String(s.title ?? 'Team'))}</h2>
        <div class="kpi-grid">
          ${s.members.map((m: { name?: string; role?: string; bio?: string }) => `
            <div class="kpi" style="min-width:220px">
              <div style="font-weight:700;font-size:12pt">${escapeHtml(String(m.name ?? ''))}</div>
              <div style="color:#6c63ff;font-size:10pt;margin:4px 0">${escapeHtml(String(m.role ?? ''))}</div>
              <div style="font-size:9pt;color:#666">${escapeHtml(String(m.bio ?? ''))}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
    }
    return `<div class="slide">
      <h2>${escapeHtml(String(s.title ?? ''))}</h2>
      ${s.body ? `<p>${escapeHtml(String(s.body)).replace(/\n\n/g, '</p><p>')}</p>` : ''}
      ${Array.isArray(s.stats) && s.stats.length ? `
        <div class="kpi-grid">
          ${s.stats.map((st: { label?: string; value?: string }) => `
            <div class="kpi">
              <div class="kpi-value">${escapeHtml(String(st.value ?? ''))}</div>
              <div class="kpi-label">${escapeHtml(String(st.label ?? ''))}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;
  }).join('');
  return wrap(title, body);
}

interface InvoiceInput {
  from: { name: string; email?: string; address?: string };
  to:   { name: string; email?: string; address?: string };
  number: string;
  date?: string;
  dueDate?: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  taxPct: number;
  notes?: string;
  currency: string;
}

function buildInvoiceHtml(title: string, inv: InvoiceInput): string {
  const subtotal = inv.items.reduce((t, i) => t + i.quantity * i.unitPrice, 0);
  const tax      = subtotal * (inv.taxPct / 100);
  const total    = subtotal + tax;
  const fmt      = (n: number) => `${inv.currency} ${n.toFixed(2)}`;
  const today    = inv.date ?? new Date().toLocaleDateString();

  const body = `
    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:40px">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Invoice #${escapeHtml(inv.number)} · ${escapeHtml(today)}</div>
        ${inv.dueDate ? `<div class="meta">Due ${escapeHtml(inv.dueDate)}</div>` : ''}
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">${escapeHtml(inv.from.name)}</div>
        ${inv.from.email ? `<div class="meta">${escapeHtml(inv.from.email)}</div>` : ''}
        ${inv.from.address ? `<div class="meta">${escapeHtml(inv.from.address).replace(/\n/g, '<br>')}</div>` : ''}
      </div>
    </div>
    <div style="margin-bottom:32px">
      <div class="meta" style="text-transform:uppercase;letter-spacing:0.08em">Bill to</div>
      <div style="font-weight:600">${escapeHtml(inv.to.name)}</div>
      ${inv.to.email ? `<div class="meta">${escapeHtml(inv.to.email)}</div>` : ''}
      ${inv.to.address ? `<div class="meta">${escapeHtml(inv.to.address).replace(/\n/g, '<br>')}</div>` : ''}
    </div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="width:80px;text-align:right">Qty</th>
          <th style="width:120px;text-align:right">Unit</th>
          <th style="width:120px;text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${inv.items.map((i) => `
          <tr>
            <td>${escapeHtml(i.description)}</td>
            <td style="text-align:right">${i.quantity}</td>
            <td style="text-align:right">${fmt(i.unitPrice)}</td>
            <td style="text-align:right">${fmt(i.quantity * i.unitPrice)}</td>
          </tr>
        `).join('')}
        <tr><td colspan="3" style="text-align:right">Subtotal</td><td style="text-align:right">${fmt(subtotal)}</td></tr>
        ${inv.taxPct > 0 ? `<tr><td colspan="3" style="text-align:right">Tax (${inv.taxPct}%)</td><td style="text-align:right">${fmt(tax)}</td></tr>` : ''}
        <tr><td colspan="3" style="text-align:right"><strong>Total</strong></td><td style="text-align:right"><strong>${fmt(total)}</strong></td></tr>
      </tbody>
    </table>
    ${inv.notes ? `<div style="margin-top:32px"><div class="meta" style="text-transform:uppercase;letter-spacing:0.08em">Notes</div><p>${escapeHtml(inv.notes)}</p></div>` : ''}
  `;
  return wrap(title, body);
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json|javascript|js|)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function documentsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get<{ Querystring: { projectId?: string } }>('/api/documents', async (req) => {
    const ctx = req.authCtx!;
    const db  = getDb();
    const where = req.query.projectId
      ? and(eq(documents.tenantId, ctx.tenantId), eq(documents.projectId, req.query.projectId))
      : eq(documents.tenantId, ctx.tenantId);
    const rows = await db.select().from(documents).where(where).orderBy(desc(documents.createdAt)).limit(200);
    return { documents: rows };
  });

  app.delete<{ Params: { id: string } }>('/api/documents/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db  = getDb();
    await db.delete(documents).where(and(eq(documents.id, req.params.id), eq(documents.tenantId, ctx.tenantId)));
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/documents/:id/download', async (req, reply) => {
    const ctx = req.authCtx!;
    const db  = getDb();
    const [row] = await db.select().from(documents).where(and(eq(documents.id, req.params.id), eq(documents.tenantId, ctx.tenantId)));
    if (!row?.assetId) return reply.status(404).send({ error: 'Document has no asset yet' });
    const [a] = await db.select().from(assets).where(eq(assets.id, row.assetId));
    if (!a?.publicUrl) return reply.status(404).send({ error: 'Asset URL missing' });
    return reply.redirect(a.publicUrl);
  });

  // SSE generate
  // OPTIONS preflight — needed because reply.hijack() bypasses @fastify/cors
  app.options('/api/documents/generate', async (req, reply) => {
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    return reply
      .header('Access-Control-Allow-Origin',  origin)
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Max-Age',       '86400')
      .header('Vary',                         'Origin')
      .status(204).send();
  });

  app.post<{ Body: unknown }>('/api/documents/generate', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    const body = parsed.data;

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

    const adapter = body.provider === 'ollama'
      ? createOllamaAdapter(env.OLLAMA_BASE_URL)
      : createMinimaxAdapter(ctx.tenantId, 'dev');

    const db = getDb();
    const [row] = await db.insert(documents).values({
      tenantId:  ctx.tenantId,
      projectId: body.projectId ?? null,
      title:     body.title,
      docType:   body.docType as DocType,
      status:    'generating',
    }).returning();
    if (!row) { send({ type: 'error', error: 'Failed to create document row' }); raw.end(); return; }
    send({ type: 'created', documentId: row.id });

    try {
      let html: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let structured: any = {};

      if (body.docType === 'invoice') {
        send({ type: 'step', step: 'render' });
        // Support both new lineItems format and legacy invoice object
        if (body.lineItems && body.lineItems.length > 0) {
          // New format: lineItems[]
          const items = body.lineItems;
          const currency = body.currency ?? 'USD';
          const subtotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
          const tax = subtotal * 0.1;
          const total = subtotal + tax;
          const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;
          const invoiceNum = `INV-${Date.now().toString().slice(-6)}`;
          const rows = items.map((it) => `
            <tr>
              <td>${escapeHtml(it.description)}</td>
              <td style="text-align:right">${it.qty}</td>
              <td style="text-align:right">${fmt(it.unitPrice)}</td>
              <td style="text-align:right">${fmt(it.qty * it.unitPrice)}</td>
            </tr>`).join('');
          const bodyContent = `
            <div style="display:flex;justify-content:space-between;margin-bottom:32px">
              <div>
                <h1 style="font-size:24pt">${escapeHtml(body.title)}</h1>
                <div class="meta">Invoice #${invoiceNum} · ${new Date().toLocaleDateString()}</div>
              </div>
              <div style="text-align:right">
                ${body.companyName ? `<div style="font-weight:700">${escapeHtml(body.companyName)}</div>` : ''}
                ${body.clientName  ? `<div class="meta">Bill To: ${escapeHtml(body.clientName)}</div>` : ''}
              </div>
            </div>
            <table>
              <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Amount</th></tr></thead>
              <tbody>
                ${rows}
                <tr><td colspan="3" style="text-align:right">Subtotal</td><td style="text-align:right">${fmt(subtotal)}</td></tr>
                <tr><td colspan="3" style="text-align:right">Tax (10%)</td><td style="text-align:right">${fmt(tax)}</td></tr>
                <tr><td colspan="3" style="text-align:right"><strong>Total Due</strong></td><td style="text-align:right"><strong>${fmt(total)}</strong></td></tr>
              </tbody>
            </table>
            <p class="meta">Payment due within 30 days. Thank you for your business.</p>`;
          html = wrap(body.title, bodyContent);
          structured = { items, subtotal, tax, total, currency, invoiceNum };
        } else if (body.invoice) {
          html = buildInvoiceHtml(body.title, body.invoice);
          structured = body.invoice;
        } else {
          throw new Error('Invoice requires lineItems or invoice input');
        }
      } else {
        send({ type: 'step', step: 'generating' });
        const contextLine = buildContextLine(body);
        const prompt = structuredPrompt(body.docType as DocType, contextLine || body.title, body.title);
        const res = await adapter.complete({ prompt, model: body.model, maxTokens: 4096, temperature: 0.6 });
        structured = JSON.parse(stripFences(String(res.text ?? '')));

        send({ type: 'step', step: 'pdf' });
        switch (body.docType) {
          case 'business_proposal': html = buildProposalHtml(body.title, structured); break;
          case 'case_study':        html = buildCaseStudyHtml(body.title, structured); break;
          case 'project_report':    html = buildReportHtml(body.title, structured); break;
          case 'pitch_deck':        html = buildPitchDeckHtml(body.title, structured); break;
          default:                  html = wrap(body.title, `<h1>${body.title}</h1><pre>${JSON.stringify(structured, null, 2)}</pre>`);
        }
      }

      const pdfBuf = await renderHtmlToPdf({
        html,
        landscape: body.docType === 'pitch_deck',
        format: 'Letter',
      });

      send({ type: 'step', step: 'upload' });
      const up = await uploadBufferAsAsset({
        tenantId:  ctx.tenantId,
        projectId: body.projectId ?? null,
        folder:    `documents/${row.id}`,
        filename:  `${slug(body.title)}.pdf`,
        mimeType:  'application/pdf',
        buffer:    pdfBuf,
      });

      await db.update(documents).set({
        status:   'ready',
        assetId:  up.assetId,
        content:  structured,
        updatedAt: new Date(),
      }).where(eq(documents.id, row.id));

      send({ type: 'done', documentId: row.id, assetId: up.assetId, url: up.url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(documents).set({ status: 'failed', error: msg, updatedAt: new Date() }).where(eq(documents.id, row.id));
      send({ type: 'error', error: msg });
    } finally {
      raw.end();
    }

    return undefined;
  });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'document';
}
