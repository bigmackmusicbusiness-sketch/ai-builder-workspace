// apps/api/src/security/spsAuthBridge.ts — Supabase session bridge for
// SPS iframe-handoff customers (round 13.2 — Option C).
//
// The handoff iframe needs a real Supabase session for the SPA's
// apiFetch to work (chat, files, preview, kickoff history all gate on
// the Supabase JWT via authMiddleware → JWKS ES256 verification). The
// api can't forge tokens (ES256 is asymmetric) so we delegate to
// Supabase's own auth flow: generate a single-use magic link for a
// proxy user via the admin API, redirect the iframe through it.
// Supabase verifies the link, mints session tokens, and 302-redirects
// to a URL we choose with the tokens in the URL fragment. The SPA's
// Supabase JS client (configured with detectSessionInUrl: true) picks
// the tokens out of the fragment and writes them to localStorage —
// the standard SSO landing pattern.
//
// One shared proxy user serves every SPS-handoff customer in v1. Cross-
// customer scoping happens at the api layer via the abw_sps_handoff
// cookie's sps_workspace_id claim (see /api/projects route + the
// readSpsHandoffCookie helper below). Per-customer Supabase users are
// a v2 enhancement once we want per-customer audit isolation.
//
// One-time Supabase setup required (NOT automated — operator step):
//   - Add the SPA's project-detail URL to the Supabase project's auth
//     Redirect URLs allow-list:
//         https://app.40-160-3-10.sslip.io/projects/**
//     Without this, generateLink will succeed but the redirect_to
//     check will reject when the iframe follows the magic link.
//   - Confirm the proxy email isn't already taken by a real user.

import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { getRawSql } from '../db/client';

/** Email of the shared proxy user. Deterministic so the
 *  ensure-or-create flow can upsert idempotently. */
const PROXY_EMAIL = 'sps-handoff-proxy@signalpoint.test';

/** Cached proxy user auth UID (auth.users.id) after the first ensure
 *  call. Resets on api restart; the next call re-resolves it. */
let cachedProxyAuthUid: string | null = null;

/** Lazy Supabase admin client. Built with service-role key. */
function adminClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  });
}

/**
 * Find or create the proxy user that all SPS iframe handoffs sign in
 * as. Idempotent — calling repeatedly returns the same auth UID. The
 * proxy user has TWO halves wired up here:
 *
 *   1. **auth.users** row (Supabase Admin API). Tagged with the
 *      system tenant + member role in user_metadata so authMiddleware
 *      accepts the JWT. No password — magic-link only.
 *
 *   2. **public.users** row (our own table, FK target for
 *      projects.created_by, audit_events.actor, etc.). Created on
 *      first ensure if missing. Its id gets stamped into the auth
 *      user's `user_metadata.internal_user_id` so authMiddleware can
 *      read it on every request without an extra DB lookup.
 *
 * The public.users row is the missing piece in v1 of this bridge
 * (round 13.2). Without it, ctx.userId fell back to the auth UID,
 * which violated the FK on every INSERT that referenced it (POST
 * /api/projects → 500). Found round 13.3 when the user tried to
 * create a project from inside the iframe.
 *
 * Migration-safe: if the proxy user already exists (created in
 * round 13.2 before this fix) but is missing either the public.users
 * row OR the internal_user_id metadata, this function lazily fixes
 * it on the next call. No manual remediation script needed.
 *
 * Safe to call from server boot or lazily on first handoff. The
 * cache only caches the auth UID; the rest is short-circuited by an
 * idempotent SELECT-then-INSERT pattern.
 */
export async function ensureSpsProxyUser(): Promise<string> {
  if (cachedProxyAuthUid) return cachedProxyAuthUid;

  const systemTenantId = process.env['SPS_SYSTEM_TENANT_ID'];
  if (!systemTenantId) {
    throw new Error(
      'SPS_SYSTEM_TENANT_ID not configured. Set it in Coolify env before ' +
      'the SPS iframe-handoff session bridge can mint tokens.',
    );
  }

  const supabase = adminClient();

  // ── 1. Find or create the auth.users row ─────────────────────────
  // listUsers is paginated; we filter the first page for the email.
  // The proxy user is the only one with this address, so it lands on
  // page 1 of the first 1000 users unless the user table has grown
  // past that — at which point we'd bump perPage.
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    page:    1,
    perPage: 1000,
  });
  if (listErr) {
    throw new Error(`Supabase admin listUsers failed: ${listErr.message}`);
  }
  let authUser = list.users.find((u) => u.email === PROXY_EMAIL);
  if (!authUser) {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email:          PROXY_EMAIL,
      email_confirm:  true,
      user_metadata: {
        tenant_id: systemTenantId,
        role:      'member',
        kind:      'sps-handoff-proxy',
      },
    });
    if (createErr || !created?.user) {
      throw new Error(
        `Supabase admin createUser failed for proxy: ${createErr?.message ?? 'no user returned'}`,
      );
    }
    authUser = created.user;
  }

  // ── 2. Find or create the public.users row ───────────────────────
  // FK target for projects.created_by, audit_events.actor, etc. The
  // existing user_metadata.internal_user_id (if any) is the source
  // of truth — we trust the stamp and verify the row still exists;
  // re-create it only if missing.
  const sql = getRawSql();
  const stampedInternalId =
    (authUser.user_metadata as Record<string, unknown> | null | undefined)?.['internal_user_id'];
  let internalUserId: string | null = null;

  // First try by stamped id (cheapest path — one indexed PK lookup).
  if (typeof stampedInternalId === 'string') {
    const rows = await sql.unsafe(
      `SELECT id FROM users WHERE id = $1 LIMIT 1`,
      [stampedInternalId],
    ) as Array<{ id: string }>;
    if (rows[0]) internalUserId = rows[0].id;
  }

  // Fall back to a lookup by supabase_uid (existing row, never stamped).
  if (!internalUserId) {
    const rows = await sql.unsafe(
      `SELECT id FROM users WHERE supabase_uid = $1 LIMIT 1`,
      [authUser.id],
    ) as Array<{ id: string }>;
    if (rows[0]) internalUserId = rows[0].id;
  }

  // Still nothing — insert the row. Race-safe via ON CONFLICT on the
  // supabase_uid uniqueness index: a parallel ensure call that wins
  // the insert leaves the loser with a no-op (RETURNING returns the
  // winner's row).
  if (!internalUserId) {
    const rows = await sql.unsafe(
      `INSERT INTO users (tenant_id, supabase_uid, email, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (supabase_uid) DO UPDATE
         SET email = EXCLUDED.email
       RETURNING id`,
      [systemTenantId, authUser.id, PROXY_EMAIL, 'SPS Handoff Proxy'],
    ) as Array<{ id: string }>;
    if (!rows[0]) {
      throw new Error('Failed to insert/upsert proxy user public.users row');
    }
    internalUserId = rows[0].id;
  }

  // ── 3. Stamp internal_user_id into user_metadata if missing ──────
  // authMiddleware reads it to set ctx.userId without a DB hit per
  // request. One updateUserById on first ensure, then noop forever.
  if (stampedInternalId !== internalUserId) {
    const existingMeta = (authUser.user_metadata as Record<string, unknown> | null | undefined) ?? {};
    const { error: updateErr } = await supabase.auth.admin.updateUserById(authUser.id, {
      user_metadata: {
        ...existingMeta,
        tenant_id:        existingMeta['tenant_id'] ?? systemTenantId,
        role:             existingMeta['role']      ?? 'member',
        kind:             existingMeta['kind']      ?? 'sps-handoff-proxy',
        internal_user_id: internalUserId,
      },
    });
    if (updateErr) {
      // Non-fatal — the JWT minted for THIS handoff still works
      // (authMiddleware falls back to payload.sub if metadata is
      // missing), but subsequent handoffs would re-do this update.
      // Log loudly so we notice.
      // eslint-disable-next-line no-console
      console.warn(
        `[spsAuthBridge] Failed to stamp internal_user_id on proxy user metadata: ${updateErr.message}. ` +
        `JWT will carry stale metadata until next ensure call.`,
      );
    }
  }

  cachedProxyAuthUid = authUser.id;
  return authUser.id;
}

/**
 * Generate a single-use magic-link action URL for the proxy user.
 * The iframe is 302-redirected to this URL; Supabase verifies the
 * OTP, mints session tokens, and redirects to `redirectTo` with the
 * tokens in the URL fragment. The SPA's Supabase client picks them up
 * via detectSessionInUrl.
 *
 * `redirectTo` must be on the Supabase project's auth Redirect URLs
 * allow-list (one-time operator setup).
 */
export async function mintSpsHandoffMagicLink(opts: {
  redirectTo: string;
}): Promise<{ actionLink: string }> {
  // Ensure the proxy user exists (idempotent — cached after first call).
  await ensureSpsProxyUser();

  const supabase = adminClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type:  'magiclink',
    email: PROXY_EMAIL,
    options: {
      redirectTo: opts.redirectTo,
    },
  });
  if (error || !data?.properties?.action_link) {
    throw new Error(
      `Supabase admin generateLink failed: ${error?.message ?? 'no action_link in response'}`,
    );
  }
  return { actionLink: data.properties.action_link };
}

// ── Cookie helper: read sps_workspace_id from the abw_sps_handoff cookie ──

/**
 * Parse the abw_sps_handoff cookie from a request and return its
 * `sps_workspace_id` claim. Returns null when the cookie is missing,
 * malformed, expired, or doesn't carry a workspace_id. Used by routes
 * that scope responses to a single SPS workspace (e.g., /api/projects
 * filters by it so the shared proxy user doesn't leak all SPS-tenant
 * projects to every iframe).
 *
 * The cookie is set by /api/sps/handoff. Its payload is a
 * URI-encoded JSON object: { sps_workspace_id, project_id, email,
 * iat, exp }. Not signed — the api treats the cookie as a scoping
 * hint, not auth (auth comes from the Supabase JWT). Tampering with
 * the cookie can scope to a different workspace's projects, but the
 * cookie is HttpOnly + SameSite=None + Secure, so JS in the iframe
 * can't read or write it. A network attacker would need TLS-MITM.
 */
export function readSpsHandoffCookie(cookieHeader: string | undefined): {
  sps_workspace_id: string;
  project_id?:      string;
  exp:              number;
} | null {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)abw_sps_handoff=([^;]+)/.exec(cookieHeader);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]!);
    const payload = JSON.parse(decoded) as {
      sps_workspace_id?: unknown;
      project_id?:       unknown;
      exp?:              unknown;
    };
    if (typeof payload.sps_workspace_id !== 'string') return null;
    if (typeof payload.exp !== 'number')              return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null; // expired
    return {
      sps_workspace_id: payload.sps_workspace_id,
      project_id:       typeof payload.project_id === 'string' ? payload.project_id : undefined,
      exp:              payload.exp,
    };
  } catch {
    return null;
  }
}
