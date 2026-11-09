// Benachrichtigungen im Client: Themen-Auswahl lesen und speichern, Geräte und
// Versandprotokoll lesen, Test-Nachricht anstoßen.
//
// Themen, Presets, Defaults und Normalisierung teilt sich die App mit dem Server
// über eine Datei in api/_lib (die gebündelten API-Handler können @larvis/shared
// nicht als Wert importieren). Der Pfad dorthin steht nur hier; der übrige Client
// importiert aus diesem Modul.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Database } from '@larvis/shared';
import { normalizePrefs, type NotificationPrefs } from '../../api/_lib/notificationPrefs';
import { cacheSet, useCachedQuery } from './cache';
import { currentEndpoint, disablePush } from './push';
import { supabase } from './supabase';
import type { SaveState } from './useAutosave';

export {
  PRESETS,
  isLeadNotifiable,
  leadLabel,
  reminderAppliesTo,
  type NotificationLogCategory,
  type NotificationPrefs,
  type Preset,
} from '../../api/_lib/notificationPrefs';

type SettingsInsert = Database['public']['Tables']['notification_settings']['Insert'];
type DeviceRow = Database['public']['Tables']['push_subscriptions']['Row'];

/** Ein Eintrag im Versandprotokoll. */
export type SentNotification = Database['public']['Tables']['notification_log']['Row'];
/** Ein Gerät mit Push-Abo — ohne die Schlüssel des Abos, die die App nicht braucht. */
export type PushDevice = Pick<DeviceRow, 'endpoint' | 'user_agent' | 'created_at' | 'last_seen_at'>;

const PREFS_CACHE_KEY = 'notifications:prefs';

// ---------------------------------------------------------------------------
// Themen-Auswahl
// ---------------------------------------------------------------------------

/** Die gespeicherte Auswahl (Zeile id=1), feldweise ergänzt; ohne Zeile die Defaults. */
export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const { data, error } = await supabase.from('notification_settings').select('prefs').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return normalizePrefs(data?.prefs);
}

/** Speichert die ganze Auswahl als Zeile id=1 und legt das Ergebnis in den Cache. */
export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  const next = normalizePrefs(prefs);
  const { error } = await supabase
    .from('notification_settings')
    .upsert({ id: 1, prefs: next as unknown as SettingsInsert['prefs'] }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  cacheSet(PREFS_CACHE_KEY, next);
  return next;
}

/**
 * Die Themen-Auswahl als Hook. prefs ist immer vollständig: bis zum ersten
 * Laden der Cache-Stand oder die Defaults; ready sagt, ob schon ein geladener
 * Stand da ist.
 *
 * update() übernimmt eine Änderung sofort in die Anzeige und speichert sie.
 * Speichervorgänge laufen nacheinander und senden jeweils die neueste Auswahl,
 * so überschreiben sich schnelle Klicks nicht. Scheitert das Speichern der
 * neuesten Auswahl, springt die Anzeige auf den zuletzt gespeicherten Stand zurück.
 */
export function useNotificationPrefs() {
  const { data, error, refetch } = useCachedQuery(PREFS_CACHE_KEY, getNotificationPrefs);
  const [prefs, setPrefs] = useState(() => normalizePrefs(data));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const shown = useRef(prefs); // was die Anzeige gerade zeigt
  const confirmed = useRef(prefs); // zuletzt geladener bzw. gespeicherter Stand
  const queued = useRef<NotificationPrefs | null>(null); // neueste, noch nicht gesendete Auswahl
  const saving = useRef(false);
  const touched = useRef(false);

  const show = useCallback((next: NotificationPrefs) => {
    shown.current = next;
    setPrefs(next);
  }, []);

  // Geladene Daten übernehmen, bis hier selbst geändert wurde. Danach ist der
  // eigene Speicherstand maßgeblich — eine später eintreffende Ladeantwort kann
  // älter sein als das, was gerade gespeichert wurde.
  useEffect(() => {
    if (data === undefined || touched.current) return;
    const fresh = normalizePrefs(data);
    confirmed.current = fresh;
    show(fresh);
  }, [data, show]);

  const drain = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    while (queued.current) {
      const next = queued.current;
      queued.current = null;
      setSaveState('saving');
      setSaveError(null);
      try {
        confirmed.current = await saveNotificationPrefs(next);
        if (!queued.current) setSaveState('saved');
      } catch (e) {
        // Liegt schon eine neuere Auswahl bereit, speichert die Schleife diese.
        if (!queued.current) {
          show(confirmed.current);
          setSaveState('error');
          setSaveError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
        }
      }
    }
    saving.current = false;
  }, [show]);

  const update = useCallback(
    (change: (current: NotificationPrefs) => NotificationPrefs) => {
      const next = normalizePrefs(change(shown.current));
      if (JSON.stringify(next) === JSON.stringify(shown.current)) return;
      touched.current = true;
      show(next);
      queued.current = next;
      void drain();
    },
    [drain, show],
  );

  return { prefs, ready: data !== undefined, error, saveState, saveError, update, refetch };
}

// ---------------------------------------------------------------------------
// Versandprotokoll und Geräte
// ---------------------------------------------------------------------------

/** Die zuletzt verschickten Nachrichten, neueste zuerst. */
export async function listRecentNotifications(limit: number): Promise<SentNotification[]> {
  const { data, error } = await supabase
    .from('notification_log')
    .select('key,category,title,body,sent_at')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Alle Geräte mit Push-Abo, zuletzt gesehene zuerst. */
export async function listDevices(): Promise<PushDevice[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint,user_agent,created_at,last_seen_at')
    .order('last_seen_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Löscht das Abo eines Geräts; der Server beliefert es danach nicht mehr. */
export async function removeDevice(endpoint: string): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw new Error(error.message);
}

const TEST_ERRORS: Record<number, string> = {
  401: 'Sitzung abgelaufen — melde dich neu an.',
  404: 'Dieses Gerät ist nicht registriert. Deaktiviere es und aktiviere es neu.',
  410: 'Das Push-Abo dieses Geräts ist abgelaufen. Deaktiviere es und aktiviere es neu.',
  500: 'Der Server konnte die Nachricht nicht senden.',
  502: 'Der Push-Dienst hat die Nachricht nicht angenommen.',
};

/**
 * Schickt eine Test-Nachricht an genau dieses Gerät, über den Server mit dem
 * Bearer der Web-Session. Wirft mit lesbarer Meldung; die Meldung des Servers
 * hat Vorrang vor der allgemeinen je Statuscode, außer bei 401 — dort hilft
 * der Hinweis zum Neu-Anmelden mehr.
 */
export async function sendTestNotification(): Promise<void> {
  const endpoint = await currentEndpoint();
  if (!endpoint) throw new Error('Auf diesem Gerät ist Push nicht aktiv.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch('/api/notifications/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    throw new Error('Keine Verbindung zum Server.');
  }
  if (res.ok) return;
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  // 410: Der Server hat das tote Abo gelöscht. Auch lokal abmelden, damit das
  // Gerät als „aus" erscheint und sich neu aktivieren lässt.
  if (res.status === 410) await disablePush().catch(() => {});
  const message = res.status === 401 ? TEST_ERRORS[401] : json.error || TEST_ERRORS[res.status];
  throw new Error(message || `Test fehlgeschlagen (${res.status}).`);
}

/** Kurzer Gerätename aus dem User-Agent: „iPhone", „Android", „Mac · Safari", „Windows · Chrome". */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  const system = /Macintosh|Mac OS X/.test(ua)
    ? 'Mac'
    : /Windows/.test(ua)
      ? 'Windows'
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Linux/.test(ua)
          ? 'Linux'
          : null;
  // Reihenfolge zählt: Edge und Opera nennen auch Chrome, Chrome nennt auch Safari.
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  if (system && browser) return `${system} · ${browser}`;
  return system ?? browser ?? 'Unbekanntes Gerät';
}
