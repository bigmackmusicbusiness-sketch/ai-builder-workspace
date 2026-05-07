// apps/api/src/agent/phases/plan.ts — Phase A: Planner subagent.
//
// Single MiniMax call. Loads per-type planner SOP + niche manifests, makes
// the model emit a `propose_plan` call with a Zod-validated plan. Returns
// the plan to the caller, who injects it into the legacy iteration loop as
// system guidance.

import { z } from 'zod';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderAdapter, ChatMessage, ToolDefinition } from '@abw/providers';

// ── Plan schema ───────────────────────────────────────────────────────────────

export const PlanCopyTargets = z.record(z.string()).optional();

export const PlanPage = z.object({
  slug:          z.string().min(1).max(60),
  title:         z.string().min(1).max(200),
  role:          z.string().max(200),
  sections:      z.array(z.string()).min(1).max(20),
  copy_targets:  PlanCopyTargets,
  seo: z.object({
    title:            z.string().max(120),
    meta_description: z.string().max(220),
  }),
  schema_org:    z.array(z.string()).optional().default([]),
});

export const PlanAsset = z.object({
  id:       z.string().min(1).max(64),
  // Includes 'video' so plans can declare a hero loop or background clip
  // (replicate_video / wan-2-1-fast). Audio added too — music studio plans
  // will eventually flow through the same shared-assets list.
  kind:     z.enum(['image', 'icon', 'illustration', 'video', 'audio']),
  prompt:   z.string().min(4).max(600),
  used_in:  z.array(z.string()).min(1),
});

export const Plan = z.object({
  niche:               z.string(),
  voice:               z.string().min(8).max(400),
  palette:             z.string(),
  sitemap:             z.array(PlanPage).min(1).max(20),
  shared_assets:       z.array(PlanAsset).max(20).default([]),
  asset_budget:        z.object({ images: z.number().int().min(0).max(50), icons: z.number().int().min(0).max(100) }).default({ images: 6, icons: 12 }),
  compliance_blocks:   z.array(z.string()).default([]),
  security_notes:      z.array(z.string()).default([]),
  human_flags:         z.array(z.string()).default([]),
});

export type PlanType = z.infer<typeof Plan>;

// ── Niche manifest schema ─────────────────────────────────────────────────────

export const NicheManifest = z.object({
  niche:               z.string(),
  label:               z.string(),
  triggers:            z.array(z.string()).min(1),
  default_sitemap:     z.array(z.object({ slug: z.string(), role: z.string() })).optional(),
  compliance_blocks:   z.array(z.string()).default([]),
  schema_org_primary:  z.string().optional(),
  voice_template:      z.string().optional(),
  palettes:            z.array(z.object({ name: z.string(), hexes: z.array(z.string()) })).default([]),
  section_library:     z.array(z.string()).default([]),
  image_directives:    z.string().optional(),
  voice_pet_words:     z.array(z.string()).optional(),
  primary_keywords:    z.array(z.string()).default([]),
}).passthrough();

export type NicheManifestType = z.infer<typeof NicheManifest>;

// ── Skills directory resolver ─────────────────────────────────────────────────

/** Find the apps/api/src/agent/skills directory at runtime. Works in both
 *  bundled prod (cwd=/app, file at /app/apps/api/dist/server.js) and dev
 *  (cwd=/app/apps/api). */
function resolveSkillsDir(): string {
  const candidates = [
    resolve(process.cwd(), 'apps', 'api', 'src', 'agent', 'skills'),
    resolve(process.cwd(), 'src', 'agent', 'skills'),
    // Bundled dist path: try dirname-relative.
    typeof __dirname !== 'undefined' ? resolve(__dirname, '..', 'agent', 'skills') : '',
  ].filter(Boolean) as string[];
  // Return the first one that exists (sync check via require would block at top level;
  // we just return the first candidate and let downstream readFile fail loudly).
  return candidates[0] ?? '';
}

const SKILLS_DIR = resolveSkillsDir();

// ── Loaders ───────────────────────────────────────────────────────────────────

/** Load the planner SOP markdown for a project type, fallback to default. */
export async function loadPlannerSOP(typeId: string): Promise<string> {
  const candidates = [
    resolve(SKILLS_DIR, 'planners', `${typeId}.md`),
    resolve(SKILLS_DIR, 'planners', 'default.md'),
  ];
  for (const path of candidates) {
    try { return await readFile(path, 'utf8'); } catch { /* try next */ }
  }
  return '';  // empty = no SOP available; planner runs with bare schema instructions
}

/** Load all niche manifests for a project type. */
export async function loadNicheManifests(typeId: string): Promise<NicheManifestType[]> {
  const dir = resolve(SKILLS_DIR, 'types', typeId, 'niches');
  let files: string[];
  try { files = await readdir(dir); } catch { return []; }
  const manifests: NicheManifestType[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, f), 'utf8');
      const parsed = NicheManifest.safeParse(JSON.parse(raw));
      if (parsed.success) manifests.push(parsed.data);
    } catch { /* skip malformed */ }
  }
  return manifests;
}

// ── Planner runner ────────────────────────────────────────────────────────────

export interface PlanInput {
  brief:           string;
  projectTypeId:   string;
  projectSlug:     string;
  adapter:         ProviderAdapter;
  model:           string;
  signal?:         AbortSignal;
}

export interface PlanResult {
  ok:    boolean;
  plan?: PlanType;
  error?: string;
  /** Raw response from the planner, for debug logs. */
  raw?:  string;
}

/** propose_plan tool definition — the ONLY tool the planner sees. */
export const proposePlanTool: ToolDefinition = {
  type: 'function',
  function: {
    name:        'propose_plan',
    description: 'Submit the complete website plan as a single structured JSON object. Call this exactly once. Do not call any other tool.',
    parameters: {
      type: 'object',
      properties: {
        plan: {
          type:        'object',
          description: 'The full plan object matching the Zod schema in the SOP.',
        },
      },
      required: ['plan'],
    },
  },
};

export async function runPlanner(input: PlanInput): Promise<PlanResult> {
  const { brief, projectTypeId, projectSlug, adapter, model, signal } = input;

  const sop = await loadPlannerSOP(projectTypeId);
  const niches = await loadNicheManifests(projectTypeId);

  // Build a compact niche-manifest summary for the model: just the trigger
  // words + niche slug. Full manifest is loaded by the executor later.
  const nicheSummary = niches.length > 0
    ? niches.map((n) =>
        `- niche="${n.niche}" triggers=[${n.triggers.map((t) => `"${t}"`).join(', ')}]`
      ).join('\n')
    : '(no niches available — use niche="generic")';

  const systemMessage = [
    sop,
    '',
    '## Available niches for this project type',
    nicheSummary,
    '',
    `## Project context`,
    `- Project type: ${projectTypeId}`,
    `- Project slug: ${projectSlug}`,
    '',
    'Respond with EXACTLY ONE call to `propose_plan`. No other tools. No prose.',
  ].join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: systemMessage },
    { role: 'user',   content: brief },
  ];

  // Single call. No iteration loop. Try parse, retry once on schema failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    let toolCallArgs = '';
    let assistantText = '';

    const signalOrDummy = signal ?? new AbortController().signal;
    for await (const chunk of adapter.chat({
      messages,
      model,
      temperature: 0.3,
      maxTokens: 4096,
      tools: [proposePlanTool],
      toolChoice: 'auto',
    }, { signal: signalOrDummy })) {
      if (signal?.aborted) return { ok: false, error: 'aborted' };
      if (chunk.type === 'delta') {
        assistantText += chunk.delta;
      } else if (chunk.type === 'tool_call') {
        if (chunk.toolCall.function.name === 'propose_plan') {
          toolCallArgs = chunk.toolCall.function.arguments;
        }
      } else if (chunk.type === 'error') {
        return { ok: false, error: chunk.error };
      } else if (chunk.type === 'done') {
        break;
      }
    }

    // No tool call → planner narrated. Try to extract JSON from text.
    if (!toolCallArgs && assistantText) {
      const jsonMatch = assistantText.match(/\{[\s\S]*\}/);
      if (jsonMatch) toolCallArgs = `{"plan":${jsonMatch[0]}}`;
    }

    if (!toolCallArgs) {
      if (attempt === 0) {
        // Retry with stricter instruction
        messages.push({
          role:    'system',
          content: 'Your last response did NOT call propose_plan. Try again. Call propose_plan with a `plan` argument that matches the JSON schema. Single tool call. No prose.',
        });
        continue;
      }
      return { ok: false, error: 'planner did not emit propose_plan tool call', raw: assistantText };
    }

    // Parse + validate
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(toolCallArgs);
    } catch {
      // Try the heroic strip-fence pattern
      const stripped = toolCallArgs.replace(/^```(?:json)?\s*|\s*```$/g, '');
      try { parsedArgs = JSON.parse(stripped); } catch {
        if (attempt === 0) {
          messages.push({
            role:    'system',
            content: `Your propose_plan args were not valid JSON. Try again — call propose_plan with valid JSON only, no markdown fences.`,
          });
          continue;
        }
        return { ok: false, error: 'propose_plan args not valid JSON', raw: toolCallArgs };
      }
    }

    // Accept either `{ plan: {...} }` or `{...}` (top-level plan)
    const planCandidate = (parsedArgs as { plan?: unknown }).plan ?? parsedArgs;
    const validation = Plan.safeParse(planCandidate);
    if (validation.success) {
      return { ok: true, plan: validation.data, raw: toolCallArgs };
    }

    if (attempt === 0) {
      // Retry with validation errors included
      const errors = validation.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
      messages.push({
        role:    'system',
        content: `Your propose_plan call failed validation:\n${errors}\nTry again. Match the schema exactly. Single tool call.`,
      });
      continue;
    }

    return {
      ok:    false,
      error: `propose_plan validation failed: ${validation.error.issues[0]?.message ?? 'unknown'}`,
      raw:   toolCallArgs,
    };
  }

  return { ok: false, error: 'planner exhausted attempts' };
}
