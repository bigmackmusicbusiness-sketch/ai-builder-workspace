// apps/api/src/security/authz.ts — server-side authorization guards.
// Never trust client-supplied tenantId, role, or hidden fields.
// All tenant/role context is derived from the authenticated JWT session.
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createClient } from '@supabase/supabase-js';

export interface AuthContext {
  userId:   string;
  tenantId: string;
  role:     'owner' | 'admin' | 'member' | 'viewer';
  email:    string;
}

/** Extract and verify the auth context from the Fastify request's Authorization header. */
export async function getAuthContext(req: FastifyRequest): Promise<AuthContext> {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing or invalid Authorization header'), { statusCode: 401 });
  }
  const token = authHeader.slice(7);

  const supabase = createClient(
    process.env['SUPABASE_URL'] ?? '',
    process.env['SUPABASE_ANON_KEY'] ?? '',
  );

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }

  // Tenant and role are stored in custom claims set by a Supabase auth hook.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = data.user.user_metadata as Record<string, any>;
  const tenantId: string = meta['tenant_id'];
  const role:     string = meta['role'] ?? 'member';

  if (!tenantId) {
    throw Object.assign(new Error('No tenant associated with this account'), { statusCode: 403 });
  }

  return {
    userId:   data.user.id,
    tenantId,
    role:     role as AuthContext['role'],
    email:    data.user.email ?? '',
  };
}

/** Require a minimum role level. Throws 403 if the user does not qualify. */
export function requireRole(
  ctx: AuthContext,
  minRole: 'owner' | 'admin' | 'member',
): void {
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
    await reply.status(statusCode).send({ error: (err as Error).message });
  }
}
