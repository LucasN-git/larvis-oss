// Lokaler Dev-Login-Bypass. Gilt nur im Vite-Dev-Server (import.meta.env.DEV) und
// nur, wenn VITE_DEV_BYPASS_AUTH=1 in apps/web/.env steht; ein Produktions-Build
// kennt den Schalter nicht, weil `DEV` dort false ist und der Code wegfällt.
//
// Zwei Stufen: Liegt unter ~/.config/larvis/dev-session.json eine echte Sitzung
// ({ "access_token", "refresh_token" }, z. B. aus dem localStorage-Eintrag
// sb-…-auth-token eines eigens dafür eingeloggten privaten Fensters kopiert, nicht aus
// dem Hauptbrowser, weil die Refresh-Tokens rotieren), liefert der Dev-Server sie nur an
// Loopback-Clients unter /__dev/session aus und die App meldet sich einmalig damit an.
// Fehlt die Datei, läuft die App mit einer Stub-Sitzung: alle Seiten sind
// erreichbar, Datenabfragen scheitern an RLS und zeigen ihre Leerzustände.
import type { Session } from '@supabase/supabase-js';

export const DEV_BYPASS_AUTH = import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH === '1';

export async function loadDevSession(): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    const res = await fetch('/__dev/session');
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; refresh_token?: string };
    return data.access_token && data.refresh_token
      ? { access_token: data.access_token, refresh_token: data.refresh_token }
      : null;
  } catch {
    return null;
  }
}

export function stubSession(): Session {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: 'dev-bypass',
    refresh_token: 'dev-bypass',
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: now + 86400,
    user: {
      id: '00000000-0000-0000-0000-000000000000',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'dev@localhost',
      app_metadata: {},
      user_metadata: { name: 'Dev' },
      created_at: new Date(0).toISOString(),
    },
  };
}
