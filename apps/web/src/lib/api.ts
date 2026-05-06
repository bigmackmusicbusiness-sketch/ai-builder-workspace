// apps/web/src/lib/api.ts — typed fetch wrapper that attaches the Supabase
// Bearer token and points at VITE_API_URL. Throws on non-2xx.
import { supabase } from './supabase';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
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
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
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
    headers: {
      Authorization:      `Bearer ${token}`,
      'X-Requested-With': 'fetch',
    },
    body,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new ApiError(res.status, errBody.error ?? res.statusText);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
