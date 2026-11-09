import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Share, SquarePlus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Badge, Button, Card, IconButton, SaveStatus } from '../../components/ui';
import { useCachedQuery } from '../../lib/cache';
import { formatRelative } from '../../lib/format';
import {
  PRESETS,
  deviceLabel,
  listDevices,
  listRecentNotifications,
  removeDevice,
  sendTestNotification,
  useNotificationPrefs,
  type NotificationLogCategory,
  type NotificationPrefs,
  type Preset,
  type PushDevice,
  type SentNotification,
} from '../../lib/notifications';
import {
  SERVICE_WORKER_INACTIVE,
  disablePush,
  enablePush,
  getPushStatus,
  immediatePushStatus,
  isIOS,
  syncSubscription,
  type PushStatus,
} from '../../lib/push';
import { MODULES } from '../../lib/modules';
import './notifications.css';

const RECENT_LIMIT = 5;

const CATEGORY_LABELS: Record<NotificationLogCategory, string> = {
  birthdays: 'Geburtstage',
  events: 'Termin',
  todos: 'ToDo',
  learnweb: 'Learnweb',
  digest: 'Tagesüberblick',
  reminder: 'Eigene Erinnerung',
  test: 'Test',
};

type Busy = 'enable' | 'disable' | 'test' | null;
type Feedback = { tone: 'success' | 'error' | 'info'; text: string } | null;

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Das hat nicht geklappt.');

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="notif-section" aria-labelledby={id}>
      <div className="notif-section__head">
        <h3 id={id} className="notif-section__title">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Switch({
  checked,
  onChange,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelledBy: string;
  describedBy: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="notif-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="notif-switch__knob" />
    </button>
  );
}

/** Preset-Auswahl als umbrechende Chips; Einfach- oder Mehrfachauswahl entscheidet isSelected/onPick. */
function ChipGroup<T extends string | number | null>({
  label,
  hint,
  presets,
  isSelected,
  onPick,
}: {
  label: string;
  hint?: string;
  presets: Preset<T>[];
  isSelected: (value: T) => boolean;
  onPick: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="notif-option">
      <span id={id} className="notif-option__label">
        {label}
        {hint && <span className="notif-option__hint"> · {hint}</span>}
      </span>
      <div className="notif-chips" role="group" aria-labelledby={id}>
        {presets.map((preset) => (
          <button
            key={String(preset.value)}
            type="button"
            className="notif-chip"
            aria-pressed={isSelected(preset.value)}
            onClick={() => onPick(preset.value)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Topic({
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="notif-topic">
      <div className="notif-topic__head">
        <div className="notif-topic__text">
          <span id={`${id}-title`} className="notif-topic__title">{title}</span>
          <span id={`${id}-desc`} className="notif-topic__desc">{description}</span>
        </div>
        <Switch checked={enabled} onChange={onToggle} labelledBy={`${id}-title`} describedBy={`${id}-desc`} />
      </div>
      {enabled && <div className="notif-topic__options">{children}</div>}
    </div>
  );
}

/** Mehrfachauswahl umschalten; die letzte verbleibende Auswahl lässt sich nicht abwählen. */
function toggleIn<T>(list: T[], value: T): T[] {
  if (!list.includes(value)) return [...list, value];
  return list.length > 1 ? list.filter((v) => v !== value) : list;
}

// ---------------------------------------------------------------------------
// Dieses Gerät
// ---------------------------------------------------------------------------

/**
 * Push-Zustand dieses Geräts und die Aktionen dazu. Prüft neu, wenn Larvis
 * wieder in den Vordergrund kommt — die Zustimmung lässt sich in den System-
 * bzw. Browser-Einstellungen ändern. onChange meldet, dass sich Geräteliste
 * oder Verlauf geändert haben können.
 */
function useThisDevice(onChange: () => void) {
  const [status, setStatus] = useState<PushStatus | 'checking'>(() => immediatePushStatus() ?? 'checking');
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const busyRef = useRef<Busy>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const load = useCallback(async () => {
    try {
      const next = await getPushStatus();
      setStatus(next.status);
      setEndpoint(next.endpoint);
    } catch (e) {
      setFeedback({ tone: 'error', text: errorText(e) });
    }
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || busyRef.current) return;
      void load();
      onChangeRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  // Rein synchron, damit enablePush() danach noch innerhalb der Klick-Geste startet.
  function begin(kind: Exclude<Busy, null>) {
    busyRef.current = kind;
    setBusy(kind);
    setFeedback(null);
  }
  function end() {
    busyRef.current = null;
    setBusy(null);
    onChangeRef.current();
  }

  async function enable() {
    begin('enable');
    try {
      if ((await enablePush()) === 'default') setFeedback({ tone: 'info', text: 'Keine Zustimmung erteilt.' });
    } catch (e) {
      setFeedback({ tone: 'error', text: errorText(e) });
    }
    await load();
    end();
  }

  async function disable() {
    begin('disable');
    try {
      await disablePush();
    } catch (e) {
      setFeedback({ tone: 'error', text: errorText(e) });
    }
    await load();
    end();
  }

  async function test() {
    begin('test');
    try {
      await sendTestNotification();
      setFeedback({ tone: 'success', text: 'Gesendet — die Nachricht sollte gleich erscheinen.' });
    } catch (e) {
      setFeedback({ tone: 'error', text: errorText(e) });
      // Ein abgelaufenes Abo ist danach lokal abgemeldet — das Gerät steht wieder auf „aus".
      await load();
    }
    end();
  }

  return { status, endpoint, busy, feedback, enable, disable, test };
}

function ThisDevice({ device }: { device: ReturnType<typeof useThisDevice> }) {
  const { status, busy, feedback } = device;
  return (
    <Section title="Dieses Gerät">
      {status === 'needs-install' ? (
        <div>
          <p className="notif-note">Auf iPhone und iPad kommen Mitteilungen nur in der installierten App an:</p>
          <ol className="notif-install">
            <li>
              In Safari auf <strong>Teilen</strong> <Share size={14} aria-hidden className="notif-install__icon" /> tippen.
            </li>
            <li>
              <strong>Zum Home-Bildschirm</strong> <SquarePlus size={14} aria-hidden className="notif-install__icon" />{' '}
              wählen.
            </li>
            <li>Larvis vom Home-Bildschirm aus öffnen und hier aktivieren.</li>
          </ol>
        </div>
      ) : status === 'unsupported' ? (
        <p className="notif-note">Dieser Browser kann keine Push-Mitteilungen empfangen.</p>
      ) : status === 'inactive' ? (
        <p className="notif-note">{SERVICE_WORKER_INACTIVE}</p>
      ) : status === 'denied' ? (
        <p className="notif-note">
          Mitteilungen sind für Larvis blockiert.{' '}
          {isIOS()
            ? 'Erlaube sie unter Einstellungen → Mitteilungen → Larvis und öffne Larvis dann wieder.'
            : 'Erlaube sie in den Website-Einstellungen des Browsers (Symbol links neben der Adresse) und lade Larvis neu.'}
        </p>
      ) : status === 'active' ? (
        <div className="notif-device">
          <span className="notif-device__status">
            <span className="notif-dot" aria-hidden />
            Aktiv auf diesem Gerät
          </span>
          <div className="notif-device__actions">
            <Button size="sm" onClick={device.test} disabled={busy !== null}>
              {busy === 'test' ? 'Sende …' : 'Test senden'}
            </Button>
            <Button size="sm" variant="ghost" onClick={device.disable} disabled={busy !== null}>
              {busy === 'disable' ? 'Deaktiviere …' : 'Deaktivieren'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="notif-device">
          <span className="notif-note">{status === 'checking' ? 'Prüfe dieses Gerät …' : 'Auf diesem Gerät aus.'}</span>
          {status === 'off' && (
            <Button variant="primary" onClick={device.enable} disabled={busy !== null}>
              {busy === 'enable' ? 'Aktiviere …' : 'Auf diesem Gerät aktivieren'}
            </Button>
          )}
        </div>
      )}
      {/* Bleibt als Live-Region im DOM, damit Test-Ergebnisse vorgelesen werden. */}
      <p className={clsx('notif-feedback', feedback && `notif-feedback--${feedback.tone}`)} role="status" aria-live="polite">
        {feedback?.text}
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Worüber
// ---------------------------------------------------------------------------

function Topics({ noDevices }: { noDevices: boolean }) {
  const { prefs, ready, error, saveState, saveError, update, refetch } = useNotificationPrefs();

  function set<K extends keyof NotificationPrefs>(
    key: K,
    change: (current: NotificationPrefs[K]) => Partial<NotificationPrefs[K]>,
  ) {
    update((p) => ({ ...p, [key]: { ...p[key], ...change(p[key]) } }));
  }

  return (
    <Section title="Worüber" aside={<SaveStatus state={saveState} />}>
      {noDevices && (
        <p className="notif-hint">
          Noch ist kein Gerät aktiviert. Die Auswahl gilt schon — ankommen wird aber erst etwas auf einem aktivierten Gerät.
        </p>
      )}
      {saveError && (
        <p className="notif-feedback notif-feedback--error" role="alert">
          Änderung zurückgenommen: {saveError}
        </p>
      )}
      {!ready && error && (
        <p className="notif-feedback notif-feedback--error" role="alert">
          Auswahl nicht geladen: {error}{' '}
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>
            Erneut laden
          </Button>
        </p>
      )}
      {/* Bis ein Stand geladen ist, gesperrt: sonst würden die Defaults gespeicherte Werte überschreiben. */}
      <fieldset className="notif-fieldset" disabled={!ready} aria-busy={!ready}>
        <div className="notif-topics">
          <Topic
            title="Geburtstage"
            description="Aus Kontakten und Google-Geburtstagen, alle eines Tages in einer Nachricht."
            enabled={prefs.birthdays.enabled}
            onToggle={(enabled) => set('birthdays', () => ({ enabled }))}
          >
            <ChipGroup
              label="Uhrzeit"
              presets={PRESETS.birthdayTime}
              isSelected={(v) => v === prefs.birthdays.time}
              onPick={(time) => set('birthdays', () => ({ time }))}
            />
            <ChipGroup
              label="Wann"
              hint="mehrere möglich"
              presets={PRESETS.birthdayDaysBefore}
              isSelected={(v) => prefs.birthdays.daysBefore.includes(v)}
              onPick={(day) => set('birthdays', (b) => ({ daysBefore: toggleIn(b.daysBefore, day) }))}
            />
          </Topic>

          <Topic
            title="Termine"
            description="Termine mit Uhrzeit aus deinen beschreibbaren Google-Kalendern und aus Kalender-Abos."
            enabled={prefs.events.enabled}
            onToggle={(enabled) => set('events', () => ({ enabled }))}
          >
            <ChipGroup
              label="Vorlauf"
              presets={PRESETS.eventLead}
              isSelected={(v) => v === prefs.events.leadMinutes}
              onPick={(leadMinutes) => set('events', () => ({ leadMinutes }))}
            />
          </Topic>

          <Topic
            title="ToDos"
            description="Offene ToDos mit Fälligkeit."
            enabled={prefs.todos.enabled}
            onToggle={(enabled) => set('todos', () => ({ enabled }))}
          >
            <ChipGroup
              label="Mit Uhrzeit"
              presets={PRESETS.todoLead}
              isSelected={(v) => v === prefs.todos.leadMinutes}
              onPick={(leadMinutes) => set('todos', () => ({ leadMinutes }))}
            />
            <ChipGroup
              label="Ganztägig fällig"
              hint="alle des Tages in einer Nachricht"
              presets={PRESETS.todoAllDayTime}
              isSelected={(v) => v === prefs.todos.allDayTime}
              onPick={(allDayTime) => set('todos', () => ({ allDayTime }))}
            />
          </Topic>

          {MODULES.learnweb && (
            <Topic
              title="Learnweb-Abgaben"
              description="Abgaben und Termine aus deinen Kursen."
              enabled={prefs.learnweb.enabled}
              onToggle={(enabled) => set('learnweb', () => ({ enabled }))}
            >
              <ChipGroup
                label="Vorlauf"
                hint="mehrere möglich"
                presets={PRESETS.learnwebLead}
                isSelected={(v) => prefs.learnweb.leadMinutes.includes(v)}
                onPick={(lead) => set('learnweb', (l) => ({ leadMinutes: toggleIn(l.leadMinutes, lead) }))}
              />
            </Topic>
          )}

          <Topic
            title="Tagesüberblick"
            description="Morgens: Termine, fällige ToDos ohne Backlog und Geburtstage des Tages."
            enabled={prefs.digest.enabled}
            onToggle={(enabled) => set('digest', () => ({ enabled }))}
          >
            <ChipGroup
              label="Uhrzeit"
              presets={PRESETS.digestTime}
              isSelected={(v) => v === prefs.digest.time}
              onPick={(time) => set('digest', () => ({ time }))}
            />
          </Topic>
        </div>
      </fieldset>
      <p className="notif-hint">
        Eigene Zeiten für einzelne Termine und ToDos stellst du dort über die Glocke ein; sie gelten auch, wenn das
        Thema aus ist.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Geräte und Verlauf
// ---------------------------------------------------------------------------

function Devices({
  devices,
  error,
  currentEndpoint,
  onRemoved,
}: {
  devices: PushDevice[] | undefined;
  error: string | null;
  currentEndpoint: string | null;
  onRemoved: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function remove(endpoint: string) {
    setRemoving(endpoint);
    setRemoveError(null);
    try {
      await removeDevice(endpoint);
      await onRemoved();
    } catch (e) {
      setRemoveError(errorText(e));
    } finally {
      setRemoving(null);
    }
  }

  const hasOthers = devices?.some((d) => d.endpoint !== currentEndpoint) ?? false;

  return (
    <Section title="Geräte">
      {devices === undefined ? (
        <p className="notif-note">{error ? `Geräte nicht geladen: ${error}` : 'Lädt …'}</p>
      ) : devices.length === 0 ? (
        <p className="notif-note">Noch kein Gerät aktiviert.</p>
      ) : (
        <ul className="notif-list">
          {devices.map((d) => {
            const label = deviceLabel(d.user_agent);
            const mine = d.endpoint === currentEndpoint;
            return (
              <li key={d.endpoint} className="notif-list__item">
                <div className="notif-list__main">
                  <span className="notif-list__title">
                    {label}
                    {mine && <Badge tone="accent">Dieses Gerät</Badge>}
                  </span>
                  <span className="notif-list__sub">Zuletzt gesehen {formatRelative(d.last_seen_at)}</span>
                </div>
                {!mine && (
                  <IconButton
                    size="sm"
                    label={`${label} entfernen`}
                    disabled={removing !== null}
                    onClick={() => void remove(d.endpoint)}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {removeError && (
        <p className="notif-feedback notif-feedback--error" role="alert">
          {removeError}
        </p>
      )}
      {hasOthers && (
        <p className="notif-hint">
          Ein entferntes Gerät meldet sich wieder an, sobald es Larvis mit erlaubten Mitteilungen öffnet.
        </p>
      )}
    </Section>
  );
}

function sentAtLabel(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return `Heute, ${format(d, 'HH:mm')}`;
  if (isYesterday(d)) return `Gestern, ${format(d, 'HH:mm')}`;
  return format(d, 'd. MMM, HH:mm', { locale: de });
}

function Recent({ entries, error }: { entries: SentNotification[] | undefined; error: string | null }) {
  return (
    <Section title="Zuletzt gesendet">
      {entries === undefined ? (
        <p className="notif-note">{error ? `Verlauf nicht geladen: ${error}` : 'Lädt …'}</p>
      ) : entries.length === 0 ? (
        <p className="notif-note">Noch nichts gesendet.</p>
      ) : (
        <ul className="notif-list">
          {entries.map((e) => (
            <li key={e.key} className="notif-list__item">
              <div className="notif-list__main">
                <span className="notif-list__title">{e.title || 'Larvis'}</span>
                {e.body && <span className="notif-list__body">{e.body}</span>}
                <span className="notif-list__sub">
                  <time dateTime={e.sent_at}>{sentAtLabel(e.sent_at)}</time>
                  {' · '}
                  {CATEGORY_LABELS[e.category as NotificationLogCategory] ?? e.category}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Karte
// ---------------------------------------------------------------------------

/**
 * Einstellungen → Benachrichtigungen, entlang der drei Ebenen des Systems:
 * dieses Gerät (Zustimmung und Push-Abo), worüber (Themen für alle Geräte),
 * dazu die Liste aller Geräte und was zuletzt verschickt wurde. Einzel-
 * Erinnerungen stellt die Glocke im Termin- bzw. ToDo-Editor ein.
 */
export function NotificationSettings() {
  const devices = useCachedQuery('notifications:devices', listDevices);
  const recent = useCachedQuery(`notifications:recent:${RECENT_LIMIT}`, () => listRecentNotifications(RECENT_LIMIT));
  const { refetch: refetchDevices } = devices;
  const { refetch: refetchRecent } = recent;
  const refreshLists = useCallback(() => {
    void refetchDevices();
    void refetchRecent();
  }, [refetchDevices, refetchRecent]);

  const device = useThisDevice(refreshLists);
  const { status, endpoint } = device;

  // Aktives Abo ohne Zeile (etwa von einem anderen Gerät entfernt): einmal neu
  // speichern — sonst fehlt das Gerät in der Liste und der Server beliefert es nicht.
  const healed = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'active' || !endpoint || !devices.data || healed.current === endpoint) return;
    if (devices.data.some((d) => d.endpoint === endpoint)) return;
    healed.current = endpoint;
    void syncSubscription().then(refetchDevices);
  }, [status, endpoint, devices.data, refetchDevices]);

  return (
    <Card>
      <h2 className="section-title">Benachrichtigungen</h2>
      <div className="notif">
        <ThisDevice device={device} />
        <Topics noDevices={devices.data?.length === 0} />
        <Devices devices={devices.data} error={devices.error} currentEndpoint={endpoint} onRemoved={refetchDevices} />
        <Recent entries={recent.data} error={recent.error} />
      </div>
    </Card>
  );
}
