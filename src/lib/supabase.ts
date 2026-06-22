import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabaseAuthStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

// Avoid Web Locks aborts when the ERP is open in multiple browser tabs.
const runWithoutCrossTabAuthLock = async <T>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<T>,
): Promise<T> => {
  return await fn();
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    lock: runWithoutCrossTabAuthLock,
  },
});

export function createSupabaseAccessTokenClient(accessToken: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    accessToken: async () => accessToken,
  });
}
