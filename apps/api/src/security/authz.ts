// apps/api/src/security/authz.ts — server-side authorization guards.
// Verifies Supabase JWTs locally using ES256 (ECDSA P-256) via the project's
// JWKS endpoint — no outbound HTTP call per request after the first key fetch.
// Keys are cached by kid; re-fetched if an unknown kid appears (key rotation).
import { webcrypto } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface AuthContext {
  userId:   string;
  tenantId: string;
  role:     'owner' | 'admin' | 'member' | 'viewer';
  email:    string;
}

// ── JWKS key cache ────────────────────────────────────────────────────────────

const keyCache = new Map<string, webcrypto.CryptoKey>();

function getJwksUrl(): string {
  const url = process.env['SUPABASE_URL'];
  if (!url) throw new Error('SUPABASE_URL is not set');
  return `${url}/auth/v1/.well-known/jwks.json`;
}

async function fetchPublicKey(kid: string): Promise<webcrypto.CryptoKey> {
  if (keyCache.has(kid)) return keyCache.get(kid)!;

  const res  = await fetch(getJwksUrl(), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw Object.assign(new Error('Failed to fetch JWKS'), { statusCode: 500 });

  const { keys } = await res.json() as { keys: (webcrypto.JsonWebKey & { kid?: string; alg?: string })[] };
  const jwk = keys.find((k) => k.kid === kid) ?? keys[0];
  if (!jwk) throw Object.assign(new Error('No matching JWK found'), { statusCode: 500 });

  const cryptoKey = await webcrypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  keyCache.set(kid, cryptoKey);
  return cryptoKey;
}

// ── JWT types ─────────────────────────────────────────────────────────────────

interface JwtHeader  { alg: string; kid?: string }
interface JwtPayload {
  sub:   string;
  email?: string;
  exp:   number;
  iat:   number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user_metadata?: Record<string, any>;
}

// ── ES256 JWT verification ────────────────────────────────────────────────────

function b64urlToBuffer(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function b64urlDecode(s: string): string {
  return new TextDecoder().decode(b64urlToBuffer(s));
}

async function verifyJwt(token: string): Promise<JwtPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Malformed token'), { statusCode: 401 });
  const [hB64, pB64, sB64] = parts as [string, string, string];

  let header: JwtHeader;
  try { header = JSON.parse(b64urlDecode(hB64)) as JwtHeader; }
  catch { throw Object.assign(new Error('Malformed token header'), { statusCode: 401 }); }

  // Fetch / cache the ECDSA public key by kid
  const publicKey = await fetchPublicKey(header.kid ?? '');

  // Verify ES256 signature
  const signingInput = new TextEncoder().encode(`${hB64}.${pB64}`);
  const signature    = b64urlToBuffer(sB64);
  const valid = await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    signature,
    signingInput,
  );
  if (!valid) throw Object.assign(new Error('Invalid token signature'), { statusCode: 401 });

  // Decode and validate payload
  let payload: JwtPayload;
  try { payload = JSON.parse(b64urlDecode(pB64)) as JwtPayload; }
  catch { throw Object.assign(new Error('Malformed token payload'), { statusCode: 401 }); }

  if (!payload.sub) throw Object.assign(new Error('Token missing subject'), { statusCode: 401 });
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error('Token expired — please sign in again'), { statusCode: 401 });
  }

  return payload;
}

// ── Auth context resolution ───────────────────────────────────────────────────

export async function getAuthContext(req: FastifyRequest): Promise<AuthContext> {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing or invalid Authorization header'), { statusCode: 401 });
  }

  const payload  = await verifyJwt(authHeader.slice(7));
  const meta     = payload.user_metadata ?? {};
  const tenantId = meta['tenant_id'] as string | undefined;
  const appRole  = (meta['role'] as string | undefined) ?? 'member';

  if (!tenantId) {
    throw Object.assign(
      new Error('No tenant associated with this account. Contact your admin.'),
      { statusCode: 403 },
    );
  }

  return {
    userId:   payload.sub,
    tenantId,
    role:     appRole as AuthContext['role'],
    email:    payload.email ?? '',
  };
}

export function requireRole(ctx: AuthContext, minRole: 'owner' | 'admin' | 'member'): void {
  const LEVELS: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
  if ((LEVELS[ctx.role] ?? 0) < (LEVELS[minRole] ?? 0)) {
    throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });
  }
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).authCtx = await getAuthContext(req);
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 401;
    return reply.status(statusCode).send({ error: (err as Error).message });
  }
}
