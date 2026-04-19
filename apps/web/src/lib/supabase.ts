// apps/web/src/lib/supabase.ts — browser-side Supabase client (anon key only).
// Never import service-role key here — that lives in the API only.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession:    true,
    storageKey:        'abw-session',
    autoRefreshToken:  true,
    detectSessionInUrl: true,
  },
});
