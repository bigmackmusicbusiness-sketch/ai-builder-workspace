// apps/web/src/lib/supabase.ts — browser-side Supabase client (anon key only).
// Never import service-role key here — that lives in the API only.
// Gracefully degrades if env vars are missing (no hard crash).
import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env['VITE_SUPABASE_URL'] as string | undefined) ?? '';
const key = (import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined) ?? '';

if (!url || !key) {
  // Warn during dev but don't crash — auth features will be unavailable
  console.warn(
    '[abw] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. ' +
    'Auth and Realtime features will be disabled. ' +
    'Add them to .env.local to enable.',
  );
}

// Use placeholder values so createClient doesn't throw — requests will 401
// but the rest of the app will remain functional (API returns 401, UI shows error).
export const supabase = createClient(
  url  || 'http://localhost:54321',
  key  || 'placeholder-anon-key',
  {
    auth: {
      persistSession:    true,
      storageKey:        'abw-session',
      autoRefreshToken:  true,
      detectSessionInUrl: true,
    },
  },
);
