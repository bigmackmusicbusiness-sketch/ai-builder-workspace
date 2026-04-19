// apps/web/src/lib/store/authStore.ts — auth session state (Zustand).
// signIn accepts a bare username (e.g. "melvin") and appends @abw.local,
// or passes a full email through as-is.
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../supabase';

interface AuthState {
  session:  Session | null;
  user:     User | null;
  loading:  boolean;

  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Call once at app boot to hydrate session from storage. */
  init: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user:    null,
  loading: true,

  signIn: async (username, password) => {
    const email = username.includes('@') ? username : `${username}@abw.local`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    set({ session: data.session, user: data.user, loading: false });
    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, loading: false });
  },

  init: () => {
    // Hydrate from persisted session immediately
    supabase.auth.getSession().then(({ data }) => {
      set({
        session: data.session,
        user:    data.session?.user ?? null,
        loading: false,
      });
    });

    // Keep in sync with Supabase tab events / token refreshes
    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        user:    session?.user ?? null,
        loading: false,
      });
    });
  },
}));
