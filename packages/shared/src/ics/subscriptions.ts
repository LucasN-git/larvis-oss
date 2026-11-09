// Kalender-Abos: Verwaltung der Tabelle calendar_subscriptions und Laden ihrer Termine.
//
// Eine Stelle für Web-API und MCP-Server. Beide reichen ihren Service-Role-Client
// herein; die Tabelle hat keine RLS-Policy, weil sie die geheimen Links hält. Nach außen
// geht ein Abo nur als CalendarSubscription (ohne Link, mit url_hint).
//
// Ein Abo kann einem Larvis-Projekt gehören (project_id). Seine Termine tragen dann diese
// project_id; die Farbe leitet die Oberfläche zur Anzeige aus dem Projekt ab, color bleibt
// unverändert die Farbe des Abos ohne Projekt.
//
// Abgerufen wird höchstens alle fünf Minuten je Abo (Cache im Prozess, gleichzeitige
// Anfragen teilen sich einen Abruf). Ein kaputtes Abo leert nie die Liste: sein Fehler
// landet in last_error, die übrigen Termine kommen trotzdem. Scheitert ein erneuter Abruf,
// liefert das Abo weiter seinen letzten gelesenen Stand (samt Fehlermeldung).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types.js';
import type { CalendarEvent, CalendarSubscription } from '../types.js';
import { SUBSCRIPTION_ID_PREFIX } from '../calendar.js';
import { fetchIcs, maskIcsUrl, normalizeIcsUrl } from './fetch.js';
import { expandIcs, IcsError, parseIcs, type ParsedCalendar } from './parse.js';

type Db = SupabaseClient<Database>;
type Row = Database['public']['Tables']['calendar_subscriptions']['Row'];

const CACHE_MS = 5 * 60_000;
/** Ein fehlgeschlagener Abruf wird eine Minute lang nicht wiederholt, sonst wartet jede Ansicht aufs Zeitlimit. */
const ERROR_CACHE_MS = 60_000;
const HEX = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertId(id: string) {
  if (!UUID.test(id)) throw new IcsError('Abo nicht gefunden.');
}
/** Standardfarbe neuer Abos, wenn keine gewählt ist. */
export const DEFAULT_SUBSCRIPTION_COLOR = '#2f6fed';

interface CacheEntry {
  at: number;
  /** Letzter erfolgreich gelesener Stand; bei `error` ein veralteter. */
  cal?: ParsedCalendar;
  error?: string;
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ParsedCalendar>>();

const cacheKey = (row: Pick<Row, 'id' | 'url'>) => `${row.id}|${row.url}`;

function invalidate(id: string) {
  for (const key of cache.keys()) if (key.startsWith(`${id}|`)) cache.delete(key);
}

function toPublic(row: Row): CalendarSubscription {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    project_id: row.project_id ?? null,
    enabled: row.enabled,
    url_hint: maskIcsUrl(row.url),
    last_synced_at: row.last_synced_at,
    last_error: row.last_error,
    created_at: row.created_at,
  };
}

function errorText(e: unknown): string {
  if (e instanceof IcsError) return e.message;
  return `Abruf fehlgeschlagen (${e instanceof Error ? e.message : String(e)}).`;
}

/** Link laden und parsen; wirft IcsError. */
async function loadCalendar(url: string): Promise<ParsedCalendar> {
  return parseIcs(await fetchIcs(url));
}

/**
 * Geparsten Feed eines Abos holen: aus dem Cache oder frisch. `fresh` sagt, ob gerade
 * erfolgreich abgerufen wurde (nur dann wird der Status in der Tabelle nachgeführt). Bei
 * `error` ist `cal` der letzte gute Stand, falls es einen gibt.
 */
async function calendarFor(row: Row): Promise<{ cal?: ParsedCalendar; fresh: boolean; error?: string }> {
  const key = cacheKey(row);
  const hit = cache.get(key);
  const now = Date.now();
  if (hit?.error) {
    if (now - hit.at < ERROR_CACHE_MS) return { cal: hit.cal, fresh: false, error: hit.error };
  } else if (hit?.cal && now - hit.at < CACHE_MS) {
    return { cal: hit.cal, fresh: false };
  }

  let pending = inflight.get(key);
  const mine = !pending;
  if (!pending) {
    pending = loadCalendar(normalizeIcsUrl(row.url));
    inflight.set(key, pending);
  }
  try {
    const cal = await pending;
    if (mine) cache.set(key, { at: Date.now(), cal });
    return { cal, fresh: mine };
  } catch (e) {
    const error = errorText(e);
    if (mine) cache.set(key, { at: Date.now(), cal: hit?.cal, error });
    return { cal: hit?.cal, fresh: false, error };
  } finally {
    if (mine) inflight.delete(key);
  }
}

/** Alle Abos (ohne gelöschte), älteste zuerst. */
export async function listCalendarSubscriptions(db: Db): Promise<CalendarSubscription[]> {
  const { data, error } = await db
    .from('calendar_subscriptions')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toPublic);
}

export interface SubscriptionEventsResult {
  events: CalendarEvent[];
  /**
   * Abos, deren Abruf gerade scheiterte (Meldung für die Oberfläche, ohne Link). `stale`:
   * das Abo lieferte trotzdem seinen letzten gelesenen Stand, seine Termine stehen in events.
   */
  errors: { id: string; name: string; error: string; stale: boolean }[];
  /** Anzahl eingeschalteter Abos (auch die ohne Termine im Fenster). */
  subscriptions: number;
  /**
   * Die Abo-Tabelle selbst war nicht lesbar (Datenbankfehler, Migration fehlt). Dann ist
   * unbekannt, ob es Abos gibt; subscriptions ist 0 und events leer.
   */
  listError: string | null;
}

/**
 * Termine aller eingeschalteten Abos im Fenster [timeMin, timeMax). Wirft nie: ist die
 * Abo-Tabelle nicht lesbar, steht das in listError; scheitert ein Abo, steht es in errors
 * und die übrigen Termine kommen trotzdem.
 */
export async function listSubscriptionEvents(
  db: Db,
  timeMin: string | Date,
  timeMax: string | Date,
): Promise<SubscriptionEventsResult> {
  let rows: Row[];
  try {
    const { data, error } = await db
      .from('calendar_subscriptions')
      .select('*')
      .is('deleted_at', null)
      .eq('enabled', true);
    if (error) throw new Error(error.message);
    rows = data ?? [];
  } catch (e) {
    const listError = `Kalender-Abos nicht lesbar (${e instanceof Error ? e.message : String(e)}).`;
    return { events: [], errors: [], subscriptions: 0, listError };
  }

  const results = await Promise.all(
    rows.map(async (row) => {
      let events: CalendarEvent[] = [];
      let message: string | undefined;
      let stale = false;
      try {
        const { cal, fresh, error } = await calendarFor(row);
        stale = Boolean(cal);
        if (cal) events = expandIcs(cal, row, timeMin, timeMax);
        message = error;
        if (fresh) {
          await db
            .from('calendar_subscriptions')
            .update({ last_synced_at: new Date().toISOString(), last_error: null })
            .eq('id', row.id)
            .then(
              () => undefined,
              () => undefined,
            );
        }
      } catch (e) {
        message = errorText(e);
      }
      if (message === undefined) return { events };
      if (row.last_error !== message) {
        await db
          .from('calendar_subscriptions')
          .update({ last_error: message })
          .eq('id', row.id)
          .then(
            () => undefined,
            () => undefined,
          );
      }
      return { events, error: { id: row.id, name: row.name, error: message, stale } };
    }),
  );

  return {
    events: results.flatMap((r) => r.events),
    errors: results.flatMap((r) => ('error' in r && r.error ? [r.error] : [])),
    subscriptions: rows.length,
    listError: null,
  };
}

/**
 * Wie steht ein Abo-Termin gerade im Feed? Für eigene Erinnerungen an Abo-Terminen, die
 * vor dem Versand prüfen, ob es den Termin zu dieser Zeit noch gibt.
 *   found       derselbe Termin beginnt weiter zu `start`; summary ist sein aktueller Titel
 *   gone        das Abo ist gelöscht oder abgeschaltet, oder der gelesene Stand hat den
 *               Termin nicht (mehr) zu dieser Zeit — verschoben oder abgesagt
 *   unreadable  der Feed ist gerade nicht lesbar und es gibt keinen gelesenen Stand,
 *               oder er schlug fehl und der letzte Stand kennt den Termin nicht
 * Wirft nur bei Datenbankfehlern.
 */
export type SubscriptionEventLookup =
  | { status: 'found'; summary: string }
  | { status: 'gone' }
  | { status: 'unreadable'; error: string };

export async function lookupSubscriptionEvent(
  db: Db,
  calendarId: string,
  eventId: string,
  start: string,
): Promise<SubscriptionEventLookup> {
  const subId = calendarId.startsWith(SUBSCRIPTION_ID_PREFIX) ? calendarId.slice(SUBSCRIPTION_ID_PREFIX.length) : '';
  if (!UUID.test(subId)) return { status: 'gone' };
  const { data: row, error } = await db
    .from('calendar_subscriptions')
    .select('*')
    .eq('id', subId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || !row.enabled) return { status: 'gone' };

  const startMs = Date.parse(start);
  if (Number.isNaN(startMs)) return { status: 'gone' };
  const { cal, error: fetchError } = await calendarFor(row);
  if (!cal) return { status: 'unreadable', error: fetchError ?? 'Abruf fehlgeschlagen.' };
  // Ein Fenster von einer Minute ab Beginn: getroffen wird jeder Termin, der dort läuft;
  // es zählt nur derselbe Termin mit demselben Beginn.
  const hit = expandIcs(cal, row, new Date(startMs), new Date(startMs + 60_000)).find(
    (e) => e.id === eventId && Date.parse(e.start) === startMs,
  );
  if (hit) return { status: 'found', summary: hit.summary };
  // Veralteter Stand ohne den Termin: nicht als abgesagt werten, er kann neuer sein als der Stand.
  if (fetchError) return { status: 'unreadable', error: fetchError };
  return { status: 'gone' };
}

function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.trim().slice(0, 80);
  return n || null;
}

function cleanColor(color: unknown): string | null {
  if (color === undefined || color === null || color === '') return null;
  if (typeof color !== 'string' || !HEX.test(color.trim())) throw new IcsError('Die Farbe muss ein Hex-Wert wie #2f6fed sein.');
  return color.trim().toLowerCase();
}

/**
 * Projekt eines Abos prüfen: null/leer löst die Zuordnung, sonst muss die id ein
 * bestehendes, nicht gelöschtes Projekt treffen. Wirft IcsError mit Meldung für die
 * Oberfläche.
 */
export async function cleanSubscriptionProjectId(db: Db, projectId: unknown): Promise<string | null> {
  if (projectId === null || projectId === '') return null;
  if (typeof projectId !== 'string' || !UUID.test(projectId)) throw new IcsError('Das Projekt gibt es nicht.');
  const { data, error } = await db
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new IcsError('Das Projekt gibt es nicht (mehr).');
  return projectId;
}

/**
 * Link einmal abrufen und als Kalender lesen. Wirft IcsError mit einer Meldung für die
 * Oberfläche, wenn dort kein Kalender liegt.
 */
async function validateLink(rawUrl: unknown): Promise<{ url: string; cal: ParsedCalendar }> {
  const url = normalizeIcsUrl(typeof rawUrl === 'string' ? rawUrl : '');
  const cal = await loadCalendar(url);
  return { url, cal };
}

export interface NewSubscriptionInput {
  url: string;
  name?: string | null;
  color?: string | null;
  /** Optionales Projekt; null oder weggelassen = ohne Projekt. */
  project_id?: string | null;
}

/** Abo anlegen, nachdem der Link einmal erfolgreich gelesen wurde. Wirft IcsError. */
export async function addCalendarSubscription(db: Db, input: NewSubscriptionInput): Promise<CalendarSubscription> {
  const color = cleanColor(input.color) ?? DEFAULT_SUBSCRIPTION_COLOR;
  const project_id = input.project_id === undefined ? null : await cleanSubscriptionProjectId(db, input.project_id);
  const { url, cal } = await validateLink(input.url);
  const name = cleanName(input.name) ?? cal.name ?? new URL(url).hostname;
  const { data, error } = await db
    .from('calendar_subscriptions')
    .insert({ name, url, color, project_id, enabled: true, last_synced_at: new Date().toISOString(), last_error: null })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  cache.set(cacheKey(data), { at: Date.now(), cal });
  return toPublic(data);
}

export interface SubscriptionPatch {
  name?: string;
  color?: string;
  enabled?: boolean;
  url?: string;
  /** Projekt zuordnen (uuid) oder lösen (null). */
  project_id?: string | null;
}

/** Name, Farbe, Schalter, Projekt oder Link eines Abos ändern. Ein neuer Link wird vorher geprüft. */
export async function updateCalendarSubscription(
  db: Db,
  id: string,
  patch: SubscriptionPatch,
): Promise<CalendarSubscription> {
  assertId(id);
  const update: Database['public']['Tables']['calendar_subscriptions']['Update'] = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (!name) throw new IcsError('Der Name darf nicht leer sein.');
    update.name = name;
  }
  if (patch.color !== undefined) {
    const color = cleanColor(patch.color);
    if (!color) throw new IcsError('Die Farbe muss ein Hex-Wert wie #2f6fed sein.');
    update.color = color;
  }
  if (patch.enabled !== undefined) update.enabled = Boolean(patch.enabled);
  if (patch.project_id !== undefined) update.project_id = await cleanSubscriptionProjectId(db, patch.project_id);
  let validated: ParsedCalendar | null = null;
  if (patch.url !== undefined) {
    const { url, cal } = await validateLink(patch.url);
    update.url = url;
    update.last_synced_at = new Date().toISOString();
    update.last_error = null;
    validated = cal;
  }
  if (!Object.keys(update).length) throw new IcsError('Nichts zu ändern.');

  const { data, error } = await db
    .from('calendar_subscriptions')
    .update(update)
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new IcsError('Abo nicht gefunden.');
  // Name, Farbe, Projekt und Schalter hängen nicht am gelesenen Kalender; nur ein neuer Link ersetzt
  // den Cache. Sonst bliebe ein gerade fehlschlagendes Abo nach dem Umbenennen leer.
  if (validated) {
    invalidate(id);
    cache.set(cacheKey(data), { at: Date.now(), cal: validated });
  }
  return toPublic(data);
}

/** Abo löschen (Soft-Delete). */
export async function deleteCalendarSubscription(db: Db, id: string): Promise<void> {
  assertId(id);
  const { data, error } = await db
    .from('calendar_subscriptions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new IcsError('Abo nicht gefunden.');
  invalidate(id);
}
