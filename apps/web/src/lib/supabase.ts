import { createClient } from '@supabase/supabase-js';
import type { Database } from '@larvis/shared';

// Beide Werte sind öffentlich (anon-Schlüssel; die Daten schützt RLS), aber
// bewusst ohne Vorgabewert: ein Fallback auf ein bestimmtes Backend hieße, dass
// ein Build ohne gesetzte Variablen unbemerkt gegen die falsche Instanz läuft.
// Lieber hier scheitern als monatelang stillschweigend woanders schreiben.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY müssen beim Build gesetzt sein.');
}

/** Projekt-URL — der resumable Upload (TUS) baut seinen Endpoint daraus. */
export const SUPABASE_URL = url;

export const supabase = createClient<Database>(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // magic-link callback
    // Explicit localStorage keeps the session through PWA restarts on iOS. Implicit
    // flow (default) is deliberate: magic-link tokens arrive in the URL hash, so the
    // session is recoverable even when the link opens in a different browser context.
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});

// Ask the browser to keep our storage durable so iOS/Safari is less likely to evict
// the saved session after a few days of not opening the app. Best-effort, no-op where
// unsupported. Runs once on module load.
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persisted?.().then((already) => {
    if (!already) navigator.storage.persist().catch(() => {});
  });
}
