// apps/web/src/lib/api.ts — typed fetch wrapper that attaches the Supabase
// Bearer token and points at VITE_API_URL. Throws on non-2xx.
import { supabase } from './supabase';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  /** Parsed JSON body of the failure response, when one was present. Lets
   *  callers reach for structured fields like `slopFlags` directly instead
   *  of regex-extracting them from `.message`. */
  public data: Record<string, unknown> | null;

  constructor(public status: number, message: string, data: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'ApiError';
    this.data = data;
  }
}

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'Not authenticated');
  return token;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    // Include cookies on cross-origin calls so the api can read the
    // `abw_sps_handoff` cookie set by /api/sps/handoff. /api/projects
    // (and any future route that scopes by SPS workspace) reads it to
    // filter results to the customer's own workspace, preventing the
    // shared SPS proxy user from seeing every workspace's projects.
    // Server CORS already has `credentials: true` so this round-trips
    // cleanly. No effect on requests without the cookie (normal users).
    credentials: 'include',
    headers: {
      'Content-Type':     'application/json',
      Authorization:      `Bearer ${token}`,
      // Required by the api's csrfGuard for non-GET requests. Browsers won't
      // send custom headers cross-origin without a CORS preflight, so this
      // header (combined with the api's origin allowlist) blocks naive
      // form-POST CSRF attacks.
      'X-Requested-With': 'fetch',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    const msg = (body && typeof body['error'] === 'string') ? body['error'] as string : res.statusText;
    throw new ApiError(res.status, msg, body);
  }
  // 204 / empty body
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Upload a file via multipart/form-data.
 * Does NOT set Content-Type — the browser fills in the multipart boundary.
 */
export async function apiFetchForm<T = unknown>(
  path: string,
  body: FormData,
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include', // see apiFetch comment — keeps SPS workspace cookie scoped
    headers: {
      Authorization:      `Bearer ${token}`,
      'X-Requested-With': 'fetch',
    },
    body,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null) as Record<string, unknown> | null;
    const msg = (errBody && typeof errBody['error'] === 'string') ? errBody['error'] as string : res.statusText;
    throw new ApiError(res.status, msg, errBody);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
