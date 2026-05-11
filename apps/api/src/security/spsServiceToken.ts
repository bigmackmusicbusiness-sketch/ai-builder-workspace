// apps/api/src/security/spsServiceToken.ts — HS256 mint for the ABW→SPS direction.
//
// Phase 3 v2 round-6 contract: ABW publish-time flow needs to mint a
// short-lived service-to-service bearer to call SPS's
// `POST /api/abw/site-config-token` issuer. SPS verifies the bearer and
// returns the site-config bundle for ABW to bake into the published site.
//
// Round 8 (Feature B) adds a second ABW→SPS scope: `assign-new-customer`.
// Same shared HS256 secret + KID; distinguishing claim is `scope`.
// SPS verifier accepts both scopes on its respective endpoints
// (mint-site-config goes to /api/abw/site-config-token, assign-new-customer
// goes to /api/abw/assign-to-new-customer).
//
// **Why we re-use the SPS_HANDOFF_KEY_<KID> shared secret** (per round 6):
// the same HS256 secret is used for both directions, distinguished only by
// iss/aud/scope. SPS's verifier requires `iss='abw', aud='sps',
// scope='mint-site-config'` for this direction; the inverse direction
// (SPS→ABW, in handoffToken.ts) requires `iss='signalpoint-systems',
// aud='abw', scope ∈ {project-create, project-handoff}`. Because the three
// gates are independent, an attacker who recovered the shared secret would
// still need to forge each direction's distinct claim set explicitly — the
// secret alone doesn't grant cross-direction privilege escalation.
//
// **Lifetime cap: 5 minutes.** SPS rejects S2S tokens with `exp - iat > 300s`
// using reason `lifetime_too_long`. Same cap as the inverse direction.
//
// **No replay protection beyond expiry.** This matches the inverse-direction
// design (handoffToken.ts comment header). If we ever need stricter replay,
// add a JTI cache backed by Upstash on the SPS verifier side; ABW already
// tolerates that change in the contract because `jti` is just an additional
// optional payload claim.

import { createHmac } from 'node:crypto';
import { b64urlEncode, resolveKey } from './handoffToken';

/** Maximum lifetime SPS accepts. Anything longer triggers a
 *  `lifetime_too_long` rejection on the verifier side. */
const MAX_S2S_LIFETIME_SEC = 5 * 60;
/** Default we mint at if the caller doesn't override. Short enough that
 *  a leaked token has minimal blast radius, long enough that clock drift
 *  doesn't reject legitimate calls. */
const DEFAULT_S2S_LIFETIME_SEC = 60;

/** Token-shape error thrown when the minter is misconfigured (not when
 *  SPS rejects — that's a different layer). All carry statusCode 500
 *  unless caller maps differently; this is a server-config issue. */
export class SpsServiceTokenError extends Error {
  statusCode = 500;
  constructor(public reason: string) {
    super(reason);
    this.name = 'SpsServiceTokenError';
  }
}

/** Scopes ABW can mint for ABW→SPS S2S calls. Each scope corresponds to
 *  a specific SPS endpoint; SPS's verifier rejects mismatched (scope, path)
 *  combinations to prevent privilege escalation across flows. */
export type AbwS2sScope = 'mint-site-config' | 'assign-new-customer';

/** Scope constants exported for callers and for parallel-direction
 *  agreement with SPS. Single source of truth. */
export const MINT_SITE_CONFIG_SCOPE     = 'mint-site-config'      as const;
export const ASSIGN_NEW_CUSTOMER_SCOPE  = 'assign-new-customer'   as const;

export interface MintAbwS2sTokenInput {
  /** UUID of the SPS workspace this token grants access to. For
   *  mint-site-config: SPS enforces `payload.sps_workspace_id ===
   *  body.workspace_id`. For assign-new-customer: no workspace exists
   *  yet (it's being created), so pass the agency's tenant_id as a
   *  reference — SPS's verifier accepts any UUID for this scope and
   *  uses the claim only for audit logging. */
  spsWorkspaceId: string;
  /** S2S scope claim. Defaults to `mint-site-config` for backward
   *  compatibility with round-6 callers. Round-8 callers pass
   *  `assign-new-customer` for the new customer-provision flow. */
  scope?:         AbwS2sScope;
  /** Optional override for token TTL in seconds. Defaults to 60s. Capped
   *  at MAX_S2S_LIFETIME_SEC (300s) — values above that throw. */
  lifetimeSec?:   number;
  /** Optional clock override for tests. Defaults to Date.now(). */
  now?:           () => number;
}

/** Mint an HS256 bearer for the ABW→SPS S2S direction.
 *
 *  Reads the active KID from `SPS_HANDOFF_KID_DEFAULT` and the matching
 *  signing key from `SPS_HANDOFF_KEY_<KID>` (same env vars as the inverse
 *  direction; per round 6, no new env to provision).
 *
 *  Returns the compact JWT string.
 *
 *  Throws SpsServiceTokenError on:
 *   - missing SPS_HANDOFF_KID_DEFAULT
 *   - unknown / malformed kid
 *   - missing or short SPS_HANDOFF_KEY_<KID>
 *   - non-UUID spsWorkspaceId
 *   - lifetime > MAX_S2S_LIFETIME_SEC
 */
export function mintAbwS2sToken(input: MintAbwS2sTokenInput): string {
  // Validate workspace UUID up-front — SPS will reject mismatches and we'd
  // rather catch a malformed UUID at mint time than at first publish.
  if (typeof input.spsWorkspaceId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.spsWorkspaceId)) {
    throw new SpsServiceTokenError('spsWorkspaceId is not a UUID');
  }

  const lifetime = input.lifetimeSec ?? DEFAULT_S2S_LIFETIME_SEC;
  if (!Number.isFinite(lifetime) || lifetime <= 0) {
    throw new SpsServiceTokenError('lifetimeSec must be a positive finite number');
  }
  if (lifetime > MAX_S2S_LIFETIME_SEC) {
    throw new SpsServiceTokenError(`lifetimeSec exceeds SPS cap of ${MAX_S2S_LIFETIME_SEC}s`);
  }

  const kid = process.env['SPS_HANDOFF_KID_DEFAULT'];
  if (!kid) {
    throw new SpsServiceTokenError('SPS_HANDOFF_KID_DEFAULT not set in env');
  }
  // resolveKey performs its own kid-format sanitisation. Returns null on:
  //   - kid contains chars outside [a-zA-Z0-9_-]
  //   - SPS_HANDOFF_KEY_<KID> not set
  //   - key < 32 bytes after base64 decode
  const key = resolveKey(kid);
  if (!key) {
    throw new SpsServiceTokenError(`SPS_HANDOFF_KEY_${kid.toUpperCase().replace(/-/g, '_')} not set, malformed, or below 32 bytes`);
  }

  const now = Math.floor((input.now?.() ?? Date.now()) / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid };
  const payload = {
    iss:              'abw',
    aud:              'sps',
    iat:              now,
    exp:              now + lifetime,
    scope:            input.scope ?? MINT_SITE_CONFIG_SCOPE,
    sps_workspace_id: input.spsWorkspaceId.toLowerCase(),
  };

  const headerB64  = b64urlEncode(Buffer.from(JSON.stringify(header), 'utf8'));
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', key)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const sigB64 = b64urlEncode(sig);

  return `${headerB64}.${payloadB64}.${sigB64}`;
}
