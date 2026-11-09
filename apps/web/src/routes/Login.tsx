import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Button, Card, TextInput } from '../components/ui';
import { Logo } from '../components/Logo';

type Mode = 'code' | 'password';

// Supabase liefert englische Meldungen; die häufigen Fälle bekommen einen deutschen Satz.
function germanError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('signups not allowed') || m.includes('user not found')) return 'Zu dieser Adresse gibt es kein Konto.';
  if (m.includes('expired') || (m.includes('invalid') && m.includes('token'))) return 'Der Code ist falsch oder abgelaufen.';
  if (m.includes('invalid login credentials')) return 'E-Mail oder Passwort stimmen nicht.';
  if (m.includes('security purposes') || m.includes('rate limit')) return 'Zu viele Versuche. Warte kurz und versuch es dann noch einmal.';
  return message;
}

// Zwei Wege auf einer Seite: Standard ist ein 6-stelliger Code per Mail, der
// hier eingetippt wird. Anders als ein Magic Link bleibt die Anmeldung dabei in
// der installierten App, statt in Safari zu landen. Das Passwort bleibt als Ausweg.
export function Login() {
  const { session, signInWithPassword, signInWithOtp, verifyOtp } = useAuth();
  const [mode, setMode] = useState<Mode>('code');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();

  // `next` lets flows like the OAuth consent screen return here for login and
  // then continue. Restrict to a same-origin path so it can't be used as an open
  // redirect (reject //host, /\host, and anything carrying a scheme).
  const nextParam = params.get('next');
  const safeNext =
    !!nextParam &&
    nextParam.startsWith('/') &&
    !nextParam.startsWith('//') &&
    !nextParam.startsWith('/\\') &&
    !nextParam.includes('://');
  const next = safeNext ? nextParam : '/';

  if (session) return <Navigate to={next} replace />;

  async function run(action: () => Promise<{ error: string | null }>): Promise<boolean> {
    setBusy(true);
    setStatus(null);
    setNotice(null);
    const res = await action();
    setBusy(false);
    if (res.error) setStatus(germanError(res.error));
    return !res.error;
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    await run(() => signInWithPassword(email, password));
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    const target = email.trim();
    const resend = codeSentTo !== null;
    if (await run(() => signInWithOtp(target))) {
      setCodeSentTo(target);
      setCode('');
      if (resend) setNotice('Ein neuer Code ist unterwegs.');
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!codeSentTo) return;
    await run(() => verifyOtp(codeSentTo, code));
  }

  function switchMode(to: Mode) {
    setMode(to);
    setStatus(null);
    setNotice(null);
    setCodeSentTo(null);
    setCode('');
  }

  const emailInput = (
    <TextInput
      type="email"
      required
      placeholder="E-Mail"
      value={email}
      autoComplete="email"
      onChange={(e) => setEmail(e.target.value)}
    />
  );

  return (
    <main style={{ display: 'grid', placeItems: 'center', height: 'var(--app-h)', overflowY: 'auto', padding: 'var(--inset-page)' }}>
      <Card style={{ width: '100%', maxWidth: 380 }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>
          <Logo />
        </h1>
        <p className="text-muted" style={{ marginBottom: 20 }}>
          Dein Life-OS. Melde dich an.
        </p>

        {mode === 'password' && (
          <form onSubmit={submitPassword} className="stack gap-sm">
            {emailInput}
            <TextInput
              type="password"
              required
              placeholder="Passwort"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" variant="primary" block disabled={busy}>
              {busy ? 'Moment…' : 'Anmelden'}
            </Button>
          </form>
        )}

        {mode === 'code' && !codeSentTo && (
          <form onSubmit={sendCode} className="stack gap-sm">
            {emailInput}
            <Button type="submit" variant="primary" block disabled={busy}>
              {busy ? 'Wird verschickt…' : 'Code schicken'}
            </Button>
          </form>
        )}

        {mode === 'code' && codeSentTo && (
          <form onSubmit={submitCode} className="stack gap-sm">
            <p className="text-muted" style={{ fontSize: 13 }}>
              Wir haben einen Code an <strong>{codeSentTo}</strong> geschickt. Er gilt 10 Minuten.
            </p>
            <TextInput
              required
              autoFocus
              placeholder="6-stelliger Code"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              aria-label="Code aus der E-Mail"
              style={{ letterSpacing: '0.3em', textAlign: 'center', fontSize: 20 }}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <Button type="submit" variant="primary" block disabled={busy || code.length !== 6}>
              {busy ? 'Moment…' : 'Anmelden'}
            </Button>
            <div className="row gap-sm" style={{ justifyContent: 'space-between' }}>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void sendCode()}>
                Code erneut schicken
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => switchMode('code')}>
                Andere E-Mail
              </Button>
            </div>
          </form>
        )}

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => switchMode(mode === 'code' ? 'password' : 'code')}
          >
            {mode === 'code' ? 'Stattdessen mit Passwort' : 'Stattdessen mit Code per E-Mail'}
          </Button>
        </div>

        {notice && !status && (
          <p className="text-muted" style={{ marginTop: 14, fontSize: 13 }}>
            {notice}
          </p>
        )}

        {status && (
          <p role="alert" style={{ marginTop: 14, fontSize: 13, color: 'var(--danger)' }}>
            {status}
          </p>
        )}
      </Card>
    </main>
  );
}
