import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiRequest } from './types.js';

// Owner-Check für Endpoints, die nur der Owner auslösen darf (z. B. der
// Learnweb-Sync, der sich mit echten SSO-Credentials einloggt und daher nicht
// öffentlich triggerbar sein soll). Verifiziert das Supabase-Session-JWT gegen
// die Projekt-JWKS (wie mcpAuth), verlangt aber KEINE client_id — eine normale
// Web-Session reicht — und prüft, dass die sub der Owner-UUID entspricht.

const OWNER_ID = process.env.LARVIS_OWNER_ID || '';

let _sb: SupabaseClient | null = null;
function verifier(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // Anon key ist öffentlich; nur damit getClaims die JWKS erreicht. Ohne
  // Vorgabewert, sonst prüft der Server Tokens gegen die falsche Instanz.
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url) throw new Error('Missing SUPABASE_URL');
  if (!key) throw new Error('Missing VITE_SUPABASE_ANON_KEY');
  _sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _sb;
}

export async function verifyOwner(req: ApiRequest): Promise<boolean> {
  const raw = req.headers['authorization'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  if (!token) return false;

  const { data, error } = await verifier().auth.getClaims(token);
  if (error || !data?.claims) return false;
  return (data.claims as { sub?: string }).sub === OWNER_ID;
}
