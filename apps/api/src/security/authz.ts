// apps/api/src/security/authz.ts — server-side authorization guards.
// Verifies Supabase JWTs locally using SUPABASE_JWT_SECRET (HS256) — no outbound
// HTTP call to Supabase on every request, which avoids latency and auth/anon-key
// permission issues with supabase.auth.getUser() in server contexts.
// Never trust client-supplied tenantId, role, or hidden fields.
import { createHmac } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface AuthContext {
  userId:   string;
  tenantId: string;
  role:     'owner' | 'admin' | 'member' | 'viewer';
  email:    string;
}

// ── JWT verification (HS256, local) ──────────────────────────────────────────

interface SupabaseJwtPayload {
  sub:           string;
  email?:        string;
  exp:           number;
  iat:           number;
  role?:         string;             // "authenticated" — Supabase DB role, not our app role
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user_metadata?: Record<string, any>;
}

function base64urlDecode(s: string): string {
  // Convert base64url → base64 → utf8
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function verifyJwt(token: string): SupabaseJwtPayload {
  const secret = process.env['SUPABASE_JWT_SECRET'];
  if (!secret) throw Object.assign(new Error('SUPABASE_JWT_SECRET is not set'), { statusCode: 500 });

  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Malformed token'), { statusCode: 401 });

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  // Verify HMAC-SHA256 signature
  const data      = `${headerB64}.${payloadB64}`;
  const expected  = createHmac('sha256', secret).update(data).digest('base64url');
  if (expected !== sigB64) {
    throw Object.assign(new Error('Invalid token signature'), { statusCode: 401 });
  }

  // Decode payload
  let payload: SupabaseJwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64)) as SupabaseJwtPayload;
  } catch {
    throw Object.assign(new Error('Malformed token payload'), { statusCode: 401 });
  }

  // Check expiry
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error('Token expired'), { statusCode: 401 });
  }

  if (!payload.sub) {
    throw Object.assign(new Error('Token missing subject'), { statusCode: 401 });
  }

  return payload;
}

// ── Auth context resolution ───────────────────────────────────────────────────

/** Extract and verify the auth context from the Fastify request's Authorization header. */
export async function getAuthContext(req: FastifyRequest): Promise<AuthContext> {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing or invalid Authorization header'), { statusCode: 401 });
  }
  const token = authHeader.slice(7);

  const payload = verifyJwt(token);

  // tenant_id and role are stored in user_metadata (set via Admin API on account creation)
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

/** Require a minimum role level. Throws 403 if the user does not qualify. */
export function requireRole(ctx: AuthContext, minRole: 'owner' | 'admin' | 'member'): void {
  const LEVELS: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
  if ((LEVELS[ctx.role] ?? 0) < (LEVELS[minRole] ?? 0)) {
    throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });
  }
}

/** Fastify preHandler that attaches authContext to request. */
export async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).authCtx = await getAuthContext(req);
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 401;
    return reply.status(statusCode).send({ error: (err as Error).message });
  }
}
