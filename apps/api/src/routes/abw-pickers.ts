// apps/api/src/routes/abw-pickers.ts — picker endpoints for the
// "Assign to new customer" + publish UI surfaces.
//
// GET /api/abw/niches    — flat list of {slug, label} from the local niche
//                          manifests we ship with the agent. ABW-owned, no
//                          SPS dependency. Cached in-process forever (file
//                          set changes on deploy, never at runtime).
//
// GET /api/abw/packages  — flat list of {slug, name, monthly_price_cents}
//                          forwarded from SPS via an S2S call. If SPS
//                          doesn't expose a listing endpoint yet (HTTP 404
//                          or 5xx), returns a curated fallback built from
//                          the v4 pricing flyer (migration 0018 on SPS).
//                          Always returns 200; never blocks the modal.

import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../security/authz';
import { env } from '../config/env';
import { loadNicheManifests } from '../agent/phases/plan';
import {
  mintAbwS2sToken,
  ASSIGN_NEW_CUSTOMER_SCOPE,
  SpsServiceTokenError,
} from '../security/spsServiceToken';

// ── Niche list (local manifests) ────────────────────────────────────────

interface NicheRow {
  slug:  string;
  label: string;
}

let nicheCache: NicheRow[] | null = null;

/** Lazily scan the niche-manifests directory once per process. Re-uses
 *  the same loader the planner uses so the dropdown is always in lockstep
 *  with what the agent can actually generate (zero drift). */
async function loadNiches(): Promise<NicheRow[]> {
  if (nicheCache) return nicheCache;
  let manifests;
  try {
    manifests = await loadNicheManifests('website');
  } catch {
    nicheCache = [];
    return nicheCache;
  }
  const rows: NicheRow[] = manifests.map((m) => ({ slug: m.niche, label: m.label }));
  rows.sort((a, b) => a.label.localeCompare(b.label));
  nicheCache = rows;
  return nicheCache;
}

// ── Package list (SPS proxy + fallback) ─────────────────────────────────

interface PackageRow {
  slug:                string;
  name:                string;
  monthly_price_cents: number;
}

/** Hard-coded fallback from SPS migration 0018 (v4 pricing flyer). Used
 *  when SPS hasn't shipped a /api/abw/packages listing endpoint OR returns
 *  an error. Slugs are kebab-cased from the human name so reps can pick
 *  a reasonable value even before SPS's listing API exists. */
const FALLBACK_PACKAGES: PackageRow[] = [
  { slug: 'website-hosting-plan', name: 'Website Hosting Plan', monthly_price_cents: 4700 },
  { slug: 'foundation-os',        name: 'Foundation OS',        monthly_price_cents: 9700 },
  { slug: 'operations-os',        name: 'Operations OS',        monthly_price_cents: 29700 },
  { slug: 'growth-os',            name: 'Growth OS',            monthly_price_cents: 59700 },
  { slug: 'command-os',           name: 'Command OS',           monthly_price_cents: 99700 },
];

/** Try the SPS listing endpoint. Returns null on any failure so the
 *  caller falls back to the curated list. */
async function fetchPackagesFromSps(tenantId: string): Promise<PackageRow[] | null> {
  let bearer: string;
  try {
    bearer = mintAbwS2sToken({
      spsWorkspaceId: tenantId,
      scope:          ASSIGN_NEW_CUSTOMER_SCOPE,
    });
  } catch (err) {
    if (err instanceof SpsServiceTokenError) {
      // eslint-disable-next-line no-console
      console.warn(`[packages] S2S mint failed (using fallback): ${err.reason}`);
    }
    return null;
  }
  const url = `${env.SPS_API_BASE_URL.replace(/\/+$/, '')}/api/abw/packages`;
  try {
    const res = await fetch(url, {
      method:  'GET',
      headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      // 404 means SPS hasn't shipped the endpoint yet — that's expected,
      // don't log noisily.
      if (res.status !== 404) {
        // eslint-disable-next-line no-console
        console.warn(`[packages] SPS returned ${res.status} — falling back to curated list`);
      }
      return null;
    }
    const json = await res.json() as { ok?: boolean; items?: unknown };
    if (!json.ok || !Array.isArray(json.items)) return null;
    const rows: PackageRow[] = [];
    for (const it of json.items) {
      if (!it || typeof it !== 'object') continue;
      const r = it as Record<string, unknown>;
      if (typeof r.slug === 'string' && typeof r.name === 'string' && typeof r.monthly_price_cents === 'number') {
        rows.push({ slug: r.slug, name: r.name, monthly_price_cents: r.monthly_price_cents });
      }
    }
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

// ── Routes ──────────────────────────────────────────────────────────────

export async function abwPickersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/abw/niches', { preHandler: authMiddleware }, async (_req, reply) => {
    const rows = await loadNiches();
    return reply.send({ ok: true, items: rows });
  });

  app.get('/api/abw/packages', { preHandler: authMiddleware }, async (req, reply) => {
    const ctx = req.authCtx!;
    const fromSps = await fetchPackagesFromSps(ctx.tenantId);
    if (fromSps) {
      return reply.send({ ok: true, items: fromSps, source: 'sps' });
    }
    return reply.send({ ok: true, items: FALLBACK_PACKAGES, source: 'fallback' });
  });
}
