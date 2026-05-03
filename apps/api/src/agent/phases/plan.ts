// apps/api/src/agent/phases/plan.ts — Phase A: Planner subagent.
//
// Single API call. Input: brief + projectType + niche manifest. Output: Zod-validated
// structured plan (sitemap, voice, palette, asset budget, compliance blocks).
//
// Foundation step: schema + stub. Step 2 wires the actual MiniMax call with
// per-type planner SOP from apps/api/src/agent/skills/planners/<typeId>.md.

import { z } from 'zod';

// ── Plan schema ───────────────────────────────────────────────────────────────

export const PlanCopyTargets = z.record(z.string()).optional();

export const PlanPage = z.object({
  slug:          z.string().min(1).max(60),
  title:         z.string().min(1).max(120),
  role:          z.string().max(200),
  sections:      z.array(z.string()).min(1).max(20),
  copy_targets:  PlanCopyTargets,
  seo: z.object({
    title:            z.string().max(60),
    meta_description: z.string().max(160),
  }),
  schema_org:    z.array(z.string()).optional(),
});

export const PlanAsset = z.object({
  id:       z.string().min(1).max(64),
  kind:     z.enum(['image', 'icon', 'illustration']),
  prompt:   z.string().min(4).max(400),
  used_in:  z.array(z.string()).min(1),
});

export const Plan = z.object({
  niche:               z.string(),
  voice:               z.string().min(8).max(400),
  palette:             z.string(),
  sitemap:             z.array(PlanPage).min(1).max(20),
  shared_assets:       z.array(PlanAsset).max(20),
  asset_budget:        z.object({ images: z.number().int().min(0).max(50), icons: z.number().int().min(0).max(100) }),
  compliance_blocks:   z.array(z.string()).default([]),
  security_notes:      z.array(z.string()).default([]),
  human_flags:         z.array(z.string()).default([]),
});

export type PlanType = z.infer<typeof Plan>;

// ── Stub implementation ───────────────────────────────────────────────────────

export interface PlanInput {
  brief:           string;
  projectTypeId:   string;
  projectSlug:     string;
  /** Pre-loaded planner SOP markdown (per-type). */
  plannerSOP:      string;
  /** Pre-loaded niche manifests (Tier 1 types). */
  nicheManifests?: unknown[];
}

export interface PlanResult {
  ok:    boolean;
  plan?: PlanType;
  error?: string;
}

/**
 * Planner subagent. Step 2 implementation: makes a single MiniMax call with the
 * planner SOP + niche manifests, validates output via Zod, retries once with
 * validation errors injected if parse fails.
 */
export async function runPlanner(input: PlanInput): Promise<PlanResult> {
  void input;
  return { ok: false, error: 'Planner not yet implemented (Step 2)' };
}
