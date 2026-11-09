import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@larvis/shared';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('[larvis-mcp] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

// Service-role client: full DB access, bypasses RLS. Runs locally only.
export const db: SupabaseClient<Database> = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Owner-UUID der Single-User-App. Storage-Pfade beginnen mit ihr, weil die Storage-RLS
// der Web-App (Anon-Key) das erste Pfadsegment gegen auth.uid() prüft. Der Service-Role-
// Client hier umgeht RLS beim Schreiben, muss die Konvention aber einhalten, sonst kann
// die App die Datei nicht lesen. Gleiche Quelle wie apps/web/api/_lib/webAuth.ts.
export const OWNER_ID = process.env.LARVIS_OWNER_ID || '';
