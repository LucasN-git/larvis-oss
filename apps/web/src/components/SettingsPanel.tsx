import { useState } from 'react';
import { MoonStar, Sun } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useTheme } from '../theme/ThemeProvider';
import { infraLinks } from '../lib/infra';
import { PROFILE_IMAGE_SRC } from '../lib/avatar';
import { NotificationSettings } from '../features/notifications/NotificationSettings';
import { Button, Card, TextInput } from './ui';
import '../routes/personal.css';

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dunkelmodus"
      className={clsx('theme-switch', dark && 'theme-switch--on')}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <span className="theme-switch__track">
        <Sun size={15} />
        <MoonStar size={15} />
        <span className="theme-switch__knob" />
      </span>
    </button>
  );
}

export function SettingsPanel() {
  const { user, signOut } = useAuth();
  const { theme } = useTheme();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const initial = (user?.email?.[0] ?? 'L').toUpperCase();
  const [avatarFailed, setAvatarFailed] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setStatus('Mindestens 8 Zeichen.');
    if (pw !== pw2) return setStatus('Passwörter stimmen nicht überein.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    setStatus(error ? error.message : 'Passwort geändert.');
    if (!error) {
      setPw('');
      setPw2('');
    }
  }

  return (
    <div className="stack-section">
      <Card>
        <div className="section-title">Profil</div>
        <div className="row center gap-md">
          <div className="avatar-preview" style={{ width: 88, height: 88 }}>
            {avatarFailed ? initial : (
              <img src={PROFILE_IMAGE_SRC} alt="Profilbild" onError={() => setAvatarFailed(true)} />
            )}
          </div>
          <div className="stack gap-sm">
            <span className="text-muted" style={{ fontSize: 12 }}>
              Profilbild liegt als Datei im Projekt: apps/web/public/profilbild.jpg. Datei
              austauschen und neu deployen, um es zu ändern.
            </span>
          </div>
        </div>
      </Card>

      <Card>
        <div className="section-title">Konto</div>
        <p className="text-muted" style={{ fontSize: 14 }}>{user?.email}</p>
      </Card>

      <Card>
        <div className="section-title">Darstellung</div>
        <div className="row between center">
          <span className="text-muted" style={{ fontSize: 14 }}>
            {theme === 'dark' ? 'Dunkelmodus' : 'Hellmodus'}
          </span>
          <ThemeSwitch />
        </div>
      </Card>

      <NotificationSettings />

      <Card>
        <div className="section-title">Passwort ändern</div>
        <form onSubmit={changePassword} className="stack gap-sm" style={{ maxWidth: 360 }}>
          <TextInput
            type="password"
            placeholder="Neues Passwort"
            value={pw}
            autoComplete="new-password"
            onChange={(e) => setPw(e.target.value)}
          />
          <TextInput
            type="password"
            placeholder="Wiederholen"
            value={pw2}
            autoComplete="new-password"
            onChange={(e) => setPw2(e.target.value)}
          />
          <div className="row between center gap-sm">
            <Button type="submit" variant="primary" disabled={busy}>Speichern</Button>
            {status && <span className="text-muted" style={{ fontSize: 13 }}>{status}</span>}
          </div>
        </form>
      </Card>

      {/* Liste von Links: eine Gruppe, Titel außerhalb des Rahmens. */}
      {infraLinks.length > 0 && (
      <section>
        <div className="section-title">Infrastruktur</div>
        <div className="group group--glyph">
          {infraLinks.map((l) => (
            <a key={l.key} className="item-row link-row" href={l.href} target="_blank" rel="noreferrer">
              <span className="row-glyph" aria-hidden>{l.icon}</span>
              <span className="item-row__main">
                <span className="item-row__title" style={{ display: 'block' }}>{l.label}</span>
                <span className="item-row__sub" style={{ display: 'block' }}>{l.sub}</span>
              </span>
              <span className="link-row__trail" aria-hidden>↗</span>
            </a>
          ))}
        </div>
      </section>
      )}

      <Card>
        <div className="section-title">Sitzung</div>
        <Button onClick={signOut}>Abmelden</Button>
      </Card>
    </div>
  );
}
