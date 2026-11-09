import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@larvis/shared';

// Server-side service-role client for the API handlers (bypasses RLS).
// Files under api/_lib are helpers, not endpoints (see scripts/build-api.mjs).
export function admin(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}
