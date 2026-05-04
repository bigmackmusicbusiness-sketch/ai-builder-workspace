#!/usr/bin/env node
// scripts/wire-agent-instructions.mjs — one-shot script to add agentInstructions
// blocks to the 17 project types that don't yet have them. The website type was
// done by hand in Step 2.
//
// Run: node scripts/wire-agent-instructions.mjs
// Idempotent — skips files that already have an agentInstructions field.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** Per-type agentInstructions config. Keys = directory name in packages/project-types/. */
const TYPES = {
  'landing-page': {
    sop: 'types/landing-page.md',
    copy: 'Single-page conversion-focused. Hero/proof/features/pricing/FAQ/CTA. Strong CTA above fold. Niche detection picks SaaS launch / lead-gen / event / course / app download / consultation patterns.',
    security: [
      'No hardcoded API keys (sk-, AKIA, pk_live_, ghp_, ya29., JWT-shaped) — auto-strip',
      'rel="noopener noreferrer" on target="_blank" — auto-fix',
      'Form fields must have <label> — auto-fix',
    ],
    nicheDir: 'types/landing-page/niches/',
    images: 4,
  },
  dashboard: {
    sop: 'types/dashboard.md',
    copy: 'React+Vite admin SPA. Sidebar nav, KPI cards, time-series charts, paginated tables, filter bar.',
    security: [
      'Auth gate on all routes by default',
      'No hardcoded API keys — env vars only',
      'CSP-conscious script tags',
    ],
    nicheDir: 'types/dashboard/niches/',
    images: 2,
  },
  'internal-tool': {
    sop: 'types/internal-tool.md',
    copy: 'list-detail-form CRUD. Audit log, role-based UI, auth gate, data table with filters.',
    security: [
      'Auth gate is mandatory',
      'Audit log every mutation',
      'Role-based UI guards on sensitive actions',
    ],
    images: 0,
  },
  'onboarding-flow': {
    sop: 'types/onboarding-flow.md',
    copy: 'Multi-step typed wizard. Progress bar. Save-and-resume. Approval gates between sensitive steps.',
    security: [
      'Validate every step input via Zod',
      'PII fields use input type="password" or masked',
      'No auto-submit — user must click Continue',
    ],
    images: 2,
  },
  'automation-panel': {
    sop: 'types/automation-panel.md',
    copy: 'Task/workflow runner UI. Queue + status + retry patterns.',
    security: [
      'Webhook receivers verify signature',
      'Trigger requires confirm step',
      'Audit run history',
    ],
    images: 0,
  },
  'saas-app': {
    sop: 'types/saas-app.md',
    copy: 'Marketing site (landing-page patterns) + dashboard SPA + auth flow. Niches: B2B SaaS / B2C SaaS / marketplace / productivity.',
    security: [
      'Auth via Supabase or NextAuth — never roll-your-own',
      'No hardcoded API keys',
      'Stripe keys via env vars only',
      'CORS configured per origin',
    ],
    nicheDir: 'types/saas-app/niches/',
    images: 8,
  },
  'api-service': {
    sop: 'types/api-service.md',
    copy: 'Fastify + Zod + OpenAPI. Standard middleware: auth, rate limit, structured logs, /health.',
    security: [
      'Credentials NEVER in source — vault/env only',
      'Zod validation on every request',
      'Rate limiting by default (Fastify rate-limit plugin)',
      'CORS allowlist, never *',
      'pino structured logs, never log secrets or full request bodies with PII',
    ],
    images: 0,
  },
  'full-stack-app': {
    sop: 'types/full-stack-app.md',
    copy: 'Generic FE+BE monorepo. Reuse saas-app patterns when ambiguous.',
    security: [
      'Auth + audit + Zod validation by default',
      'No hardcoded keys',
    ],
    images: 4,
  },
  ebook: {
    sop: 'types/ebook.md',
    copy: 'KDP-ready manuscript. Front matter (title, copyright, dedication, ToC, foreword). Back matter (about author, also-by, acknowledgments). Cover spec.',
    security: [
      'NO <script> tags — PDFs and EPUB do not execute JS',
      'No external CDN refs',
    ],
    nicheDir: 'types/ebook/niches/',
    images: 6,
  },
  document: {
    sop: 'types/document.md',
    copy: 'Proposal / case study / invoice / pitch deck / white paper / contract templates. Section libraries by document kind.',
    security: [
      'NO <script> tags',
      'Sanitize any user-supplied content for PDF rendering',
    ],
    images: 4,
  },
  'email-composer': {
    sop: 'types/email-composer.md',
    copy: 'HTML email. Single-column inline-CSS layouts. CAN-SPAM/GDPR unsubscribe footer required.',
    security: [
      'Inline CSS only — many email clients strip <style>',
      'No external scripts (email clients block JS)',
      'Unsubscribe link required (CAN-SPAM compliance)',
      'Image alt text required',
    ],
    nicheDir: 'types/email-composer/niches/',
    images: 2,
  },
  'music-studio': {
    sop: 'types/music-studio.md',
    copy: 'Beat (trap/lo-fi/boom-bap/drill) and cinematic (orchestral/ambient/tension/upbeat). BPM ranges, key suggestions, stem layout.',
    security: [
      'No copyrighted samples without license',
      'Stems labeled by role (kick, snare, hat, bass, melody, vocal)',
    ],
    images: 1,
  },
  'ai-movie': {
    sop: 'types/ai-movie.md',
    copy: 'Long-form structure: act 1/2/3, scene boundaries, voiceover scripting, music cue sheet.',
    security: [
      'No copyrighted music without license',
      'No likeness of real people without consent',
    ],
    images: 0,
  },
  'ai-commercial': {
    sop: 'types/ai-commercial.md',
    copy: '15/30/60s ad structure: hook/problem/solution/CTA. Pacing rules.',
    security: [
      'Trademark + copyright cleared assets only',
      'Required disclaimers per ad regulator (FTC, ASA)',
    ],
    images: 0,
  },
  'ai-short': {
    sop: 'types/ai-short.md',
    copy: '15-60s vertical. Hook in first 1.5s, single beat, payoff. Vertical safe zones.',
    security: [
      'Trending audio licensing per platform (TikTok, Reels)',
      'Vertical safe zones (top 14% / bottom 18%)',
    ],
    images: 0,
  },
  'ai-music-video': {
    sop: 'types/ai-music-video.md',
    copy: 'Sync-to-beat patterns. Visual energy curve. Lyric overlays optional. Multi-scene structure.',
    security: [
      'Music license required',
      'Lyric attribution required',
    ],
    images: 0,
  },
  blank: {
    sop: 'types/blank.md',
    copy: 'Generic. Asks ONE clarifying question via human_flags if brief is ambiguous. Otherwise infers minimum viable scaffold.',
    security: [
      'No hardcoded credentials',
      'rel="noopener" on outbound _blank links',
    ],
    images: 2,
  },
};

function buildBlock(cfg) {
  const security = cfg.security.map((s) => `'${s.replace(/'/g, "\\'")}'`).join(',\n      ');
  const niche = cfg.nicheDir ? `\n      nicheManifestPath: '${cfg.nicheDir}',` : '';
  const detect = cfg.nicheDir ? `\n      detectFromPrompt:  true,` : '';
  return `
  agentInstructions: {
    systemPromptPrelude: '${cfg.sop}',
    copyGuidance:
      '${cfg.copy.replace(/'/g, "\\'")}',
    securitySOPs: [
      ${security},
    ],
    multiPageStrategy: {${niche}${detect}
    },
    assetBudget: { images: ${cfg.images}, icons: 8 },
  },
}`;
}

let done = 0;
let skipped = 0;

for (const [typeId, cfg] of Object.entries(TYPES)) {
  const filePath = resolve(ROOT, 'packages', 'project-types', typeId, 'index.ts');
  let src;
  try { src = readFileSync(filePath, 'utf8'); }
  catch { console.log(`SKIP ${typeId}: file not found`); skipped++; continue; }

  if (/agentInstructions\s*:/.test(src)) {
    console.log(`SKIP ${typeId}: agentInstructions already present`);
    skipped++;
    continue;
  }

  // Find the closing `};` of the exported ProjectType. The file ends with
  // `screens: [...]};` so we transform the last `]};` into `]},` + agentInstructions block + `};`.
  const block = buildBlock(cfg);
  const updated = src.replace(/(\bscreens:\s*\[[^\]]*\]),?\n};\s*$/m, `$1,${block};\n`);

  if (updated === src) {
    console.log(`MISS ${typeId}: could not locate insertion point`);
    skipped++;
    continue;
  }

  writeFileSync(filePath, updated, 'utf8');
  console.log(`✓ ${typeId}`);
  done++;
}

console.log(`\nDone: ${done} updated, ${skipped} skipped`);
