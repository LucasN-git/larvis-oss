import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { Button, Card } from '../components/ui';
import { LogoMark } from '../components/Logo';

// Consent screen for the Supabase OAuth 2.1 server. When an MCP client (claude.ai)
// starts the authorization flow, Supabase sends the user here with ?authorization_id.
// We show what the client wants and approve/deny via the supabase.auth.oauth API.
// Public route on purpose: it handles its own auth (redirects to /login if needed).

interface Details {
  authorization_id: string;
  redirect_uri: string;
  client: { name?: string };
  scope: string;
}

export function OAuthConsent() {
  const { session, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const authId = params.get('authorization_id');

  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authLoading || !session || !authId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authId);
      if (cancelled) return;
      if (error || !data) {
        setError(error?.message ?? 'Ungültige Anfrage.');
      } else if ('authorization_id' in data) {
        setDetails(data as Details);
      } else {
        // Already consented — Supabase returns a ready redirect URL.
        window.location.href = data.redirect_url;
        return;
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session, authId]);

  if (!authId) return <Message text="Fehlender authorization_id-Parameter." />;
  if (authLoading) return <Message text="Lädt…" />;
  if (!session) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authId)}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (loading) return <Message text="Lädt…" />;
  if (error) return <Message text={error} />;
  if (!details) return <Message text="Keine offene Autorisierung gefunden." />;

  async function decide(approve: boolean) {
    if (!authId) return;
    setBusy(true);
    setError(null);
    const fn = approve
      ? supabase.auth.oauth.approveAuthorization(authId, { skipBrowserRedirect: true })
      : supabase.auth.oauth.denyAuthorization(authId, { skipBrowserRedirect: true });
    const { data, error } = await fn;
    if (error || !data) {
      setError(error?.message ?? 'Fehler bei der Verarbeitung.');
      setBusy(false);
      return;
    }
    window.location.href = data.redirect_url;
  }

  const scopes = details.scope.split(' ').map((s) => s.trim()).filter(Boolean);

  return (
    <main style={{ display: 'grid', placeItems: 'center', height: 'var(--app-h)', overflowY: 'auto', padding: 'var(--inset-page)' }}>
      <Card style={{ width: '100%', maxWidth: 420 }}>
        <div className="row gap-sm center" style={{ marginBottom: 6 }}>
          <LogoMark size={24} />
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Zugriff erlauben?</h1>
        </div>
        <p className="text-muted" style={{ marginBottom: 16 }}>
          <strong>{details.client.name || 'Eine Anwendung'}</strong> möchte als du auf Larvis
          zugreifen (Todos, Notizen, Projekte, Kalender).
        </p>

        <div className="stack gap-sm" style={{ fontSize: 13, marginBottom: 20 }}>
          <div className="row gap-sm" style={{ justifyContent: 'space-between' }}>
            <span className="text-muted">Weiterleitung</span>
            <span style={{ wordBreak: 'break-all', textAlign: 'right' }}>{details.redirect_uri}</span>
          </div>
          {scopes.length > 0 && (
            <div className="row gap-sm" style={{ justifyContent: 'space-between' }}>
              <span className="text-muted">Berechtigungen</span>
              <span style={{ textAlign: 'right' }}>{scopes.join(', ')}</span>
            </div>
          )}
        </div>

        <div className="stack gap-sm">
          <Button variant="primary" block disabled={busy} onClick={() => decide(true)}>
            {busy ? 'Moment…' : 'Erlauben'}
          </Button>
          <Button block disabled={busy} onClick={() => decide(false)}>
            Ablehnen
          </Button>
        </div>

        {error && (
          <p className="text-muted" style={{ marginTop: 14, fontSize: 13 }}>
            {error}
          </p>
        )}
      </Card>
    </main>
  );
}

function Message({ text }: { text: string }) {
  return (
    <main style={{ display: 'grid', placeItems: 'center', height: 'var(--app-h)', overflowY: 'auto', padding: 'var(--inset-page)' }}>
      <span className="text-muted">{text}</span>
    </main>
  );
}
