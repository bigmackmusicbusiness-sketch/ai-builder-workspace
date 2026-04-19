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
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
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
