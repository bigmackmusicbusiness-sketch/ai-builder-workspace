// apps/api/src/security/handoffToken.ts — HS256 verify for cross-project handoff
// tokens issued by SignalPointSystems (SPS).
//
// Phase 2.5 of the bidirectional ABW ↔ SPS integration: SPS mints short-lived
// HS256 tokens to (a) create a workspace-scoped project on ABW, and (b) deep-
// link a customer into a specific ABW project from inside the SPS portal.
//
// **Why HS256, not ES256:** SPS and ABW share infrastructure ownership. A
// shared symmetric secret kept server-side in both vaults is simpler than
// public-key signing and is enough security for the trust boundary we have.
// If that assumption ever changes, swap to ES256 — token shape is unchanged.
//
// **Key storage:** signing keys live in process env vars
// (SPS_HANDOFF_KID_DEFAULT + SPS_HANDOFF_KEY_<KID>), set in Coolify or the
// equivalent secret manager. Multiple keys can be active simultaneously to
// support rotation: rotate by setting a new SPS_HANDOFF_KEY_<NEW_KID>,
// updating SPS_HANDOFF_KID_DEFAULT to point at it, then deleting the old
// SPS_HANDOFF_KEY_<OLD_KID> after a 24h overlap window.
//
// **Replay protection:** expiry-based, not nonce-based. Tokens are required
// to have iat ≤ now ≤ exp AND (exp - iat) ≤ 5 minutes. Anyone replaying a
// stolen token gets at most one 5-minute window of access. v2 can add a
// single-use JTI cache backed by Upstash if we need stricter replay.
//
// **Used by:** apps/api/src/routes/sps-handoff.ts (the POST /api/sps/projects
// + GET /api/sps/handoff endpoints).

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Maximum lifetime of a handoff token. Anything longer is rejected up-front
 *  so a stolen token can't be replayed for hours. */
const MAX_TOKEN_LIFETIME_SEC = 5 * 60;

/** Allowed scopes. Tokens carry exactly one.
 *
 *  - `project-create`: SPS → ABW; mints a new project in ABW for a SPS
 *    workspace (used when SPS Service Center provisions a website).
 *  - `project-handoff`: SPS → ABW; deep-links a customer into an existing
 *    project's IDE (used for the "Manage my site" iframe flow).
 *  - `transfer-ownership`: SPS → ABW (round 8); re-parents an ABW project
 *    from the agency tenant to the customer's SPS workspace after Stripe
 *    checkout completes.
 *  - `project-kickoff`: SPS → ABW (round 12); seeds an existing ABW
 *    project's chat with a one-shot kickoff message from SPS's
 *    auto-onboarding pipeline. Eager mode (Option B): the kickoff
 *    endpoint fires the agent run server-side so the site is already
 *    built when the customer first opens the IDE.
 *  - `project-chat`: SPS → ABW (round 14); drives a multi-turn
 *    conversation with ABW's agent from SPS's autonomous
 *    build-driver. POST appends a user message and (default) fires
 *    the agent. GET polls messages since a cursor + agent status +
 *    file count so the driver can detect "build complete." Replaces
 *    the silent-fail mode of the kickoff endpoint with an observable
 *    chat loop. */
export type HandoffScope =
  | 'project-create'
  | 'project-handoff'
  | 'transfer-ownership'
  | 'project-kickoff'
  | 'project-chat';

/** Exported scope constants for callers + parallel-direction agreement
 *  with SPS. Single source of truth. */
export const PROJECT_CREATE_SCOPE     = 'project-create'    as const;
export const PROJECT_HANDOFF_SCOPE    = 'project-handoff'   as const;
export const TRANSFER_OWNERSHIP_SCOPE = 'transfer-ownership' as const;
export const PROJECT_KICKOFF_SCOPE    = 'project-kickoff'   as const;
export const PROJECT_CHAT_SCOPE       = 'project-chat'      as const;

/** Token payload shape. Required fields are enforced by verifyHandoffToken. */
export interface HandoffPayload {
  iss:                'signalpoint-systems'; // issuer must be SPS
  aud:                'abw';                 // audience must be us
  iat:                number;                // unix seconds
  exp:                number;                // unix seconds, ≤ iat + MAX_TOKEN_LIFETIME_SEC
  scope:              HandoffScope;
  sps_workspace_id:   string;                // uuid; owns the project on the SPS side
  /** Optional fields, semantics vary by scope: */
  email?:             string;                // for project-handoff: user being signed in
  project_id?:        string;                // for project-handoff + transfer-ownership: target ABW project
  niche_slug?:        string;                // for project-create: niche to scaffold
  project_kind?:      string;                // for project-create: project type enum value
  project_name?:      string;                // for project-create: display name
}

interface JwtHeader {
  alg: 'HS256';
  typ?: 'JWT';
  kid: string;
}

/** Errors thrown by verifyHandoffToken. Always carry statusCode 401 unless
 *  noted; callers map to a 401 JSON response. */
export class HandoffTokenError extends Error {
  statusCode = 401;
  constructor(public reason: string) {
    super(reason);
    this.name = 'HandoffTokenError';
  }
}

// ── Base64URL helpers (Node's built-in atob/btoa wrap base64 without URL-safe chars) ──
// Exported so the ABW→SPS S2S minter (apps/api/src/security/spsServiceToken.ts)
// can reuse them. Both directions share the same JWT-compact encoding.

export function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function b64urlDecodeToBuffer(s: string): Buffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64');
}

function b64urlDecodeToString(s: string): string {
  return b64urlDecodeToBuffer(s).toString('utf8');
}

// ── Key resolution ────────────────────────────────────────────────────────────

/** Resolve a signing key by its kid. The key is base64-encoded in the env var.
 *  Returns null if unknown — the caller throws 401.
 *
 *  Exported because the ABW→SPS S2S direction uses the SAME shared secret
 *  (per SPS round 6 INBOUND): both directions read `SPS_HANDOFF_KEY_<KID>`,
 *  the iss/aud/scope claims create the per-direction gate. Reusing this
 *  function keeps the kid-sanitisation rules consistent between
 *  verify-incoming (handoffToken.ts) and mint-outgoing (spsServiceToken.ts). */
export function resolveKey(kid: string): Buffer | null {
  // Sanitise kid before using as part of an env var name to avoid `KID=../`
  // shenanigans. Restrict to [a-zA-Z0-9_-].
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(kid)) return null;

  const envName = `SPS_HANDOFF_KEY_${kid.toUpperCase().replace(/-/g, '_')}`;
  const raw = process.env[envName];
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, 'base64');
    // HMAC-SHA256 requires at least 32 bytes of key material
    if (key.length < 32) return null;
    return key;
  } catch {
    return null;
  }
}

// ── Verify ────────────────────────────────────────────────────────────────────

/** Verify a handoff token. Returns the payload on success; throws
 *  HandoffTokenError(401) on any failure (malformed, bad sig, expired,
 *  unknown kid, wrong issuer/audience).
 *
 *  Does NOT enforce a specific scope — callers pass `expectedScope` to
 *  enforce that.
 */
export function verifyHandoffToken(token: string, expectedScope: HandoffScope): HandoffPayload {
  if (typeof token !== 'string' || token.length === 0) {
    throw new HandoffTokenError('missing token');
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw new HandoffTokenError('malformed token (parts)');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  // Header
  let header: JwtHeader;
  try {
    header = JSON.parse(b64urlDecodeToString(headerB64)) as JwtHeader;
  } catch {
    throw new HandoffTokenError('malformed token (header json)');
  }
  if (header.alg !== 'HS256') throw new HandoffTokenError('unsupported alg');
  if (typeof header.kid !== 'string') throw new HandoffTokenError('missing kid');

  // Resolve signing key by kid
  const key = resolveKey(header.kid);
  if (!key) throw new HandoffTokenError('unknown kid');

  // Verify signature: HMAC-SHA256 over `${headerB64}.${payloadB64}`
  const expectedSig = createHmac('sha256', key)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const givenSig = b64urlDecodeToBuffer(sigB64);
  if (givenSig.length !== expectedSig.length) throw new HandoffTokenError('bad signature length');
  if (!timingSafeEqual(givenSig, expectedSig)) throw new HandoffTokenError('signature mismatch');

  // Parse payload
  let payload: HandoffPayload;
  try {
    payload = JSON.parse(b64urlDecodeToString(payloadB64)) as HandoffPayload;
  } catch {
    throw new HandoffTokenError('malformed token (payload json)');
  }

  // Issuer / audience
  if (payload.iss !== 'signalpoint-systems') throw new HandoffTokenError('bad issuer');
  if (payload.aud !== 'abw') throw new HandoffTokenError('bad audience');

  // Expiry / lifetime
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    throw new HandoffTokenError('missing iat/exp');
  }
  if (payload.exp <= now) throw new HandoffTokenError('expired');
  if (payload.iat > now + 30) throw new HandoffTokenError('issued in the future'); // 30s clock skew tolerance
  if (payload.exp - payload.iat > MAX_TOKEN_LIFETIME_SEC) {
    throw new HandoffTokenError(`token lifetime exceeds ${MAX_TOKEN_LIFETIME_SEC}s`);
  }

  // Scope match
  if (payload.scope !== expectedScope) {
    throw new HandoffTokenError(`bad scope (expected ${expectedScope}, got ${payload.scope})`);
  }

  // Workspace id
  if (typeof payload.sps_workspace_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sps_workspace_id)) {
    throw new HandoffTokenError('bad sps_workspace_id (not a uuid)');
  }

  return payload;
}

/** Test-only: mint a token with a given key. NEVER call this in production
 *  request paths — SPS is the issuer, ABW only verifies. Used by integration
 *  tests to exercise the verification logic without depending on SPS being up. */
export function __testMintHandoffToken(opts: {
  key:    Buffer;
  kid:    string;
  payload: Omit<HandoffPayload, 'iss' | 'aud'>;
}): string {
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT', kid: opts.kid };
  const fullPayload: HandoffPayload = {
    iss: 'signalpoint-systems',
    aud: 'abw',
    ...opts.payload,
  };
  const headerB64  = b64urlEncode(Buffer.from(JSON.stringify(header), 'utf8'));
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(fullPayload), 'utf8'));
  const sig = createHmac('sha256', opts.key)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  return `${headerB64}.${payloadB64}.${b64urlEncode(sig)}`;
}
