// Benachrichtigungs-Regeln für Browser und Minuten-Tick: welche Themen es gibt,
// welche Presets je Thema wählbar sind, was ohne gespeicherte Auswahl gilt,
// welche Termine eine Vorlauf-Nachricht bekommen und wie Berliner Uhrzeiten auf
// Zeitpunkte abgebildet werden.
//
// Eine Datei für beide Seiten: Die API-Handler können @larvis/shared zur
// Laufzeit nicht als Wert importieren (siehe api/_lib/calendar.ts), deshalb
// importiert der Client diese Datei direkt (über src/lib/notifications.ts).
// Hier stehen nur reine Logik und Intl — keine Node-, DOM- oder Supabase-APIs.
import type { CalendarEvent } from '@larvis/shared';

export const NOTIFICATION_TZ = 'Europe/Berlin';
const MIN = 60_000;

/** Themen, zu denen Larvis automatisch benachrichtigt. */
export type NotificationCategory = 'birthdays' | 'events' | 'todos' | 'learnweb' | 'digest';

/** Alles, was im Versandprotokoll landet: die Themen plus Einzel-Erinnerungen und Test-Pushes. */
export type NotificationLogCategory = NotificationCategory | 'reminder' | 'test';

/**
 * Die Themen-Auswahl. Gilt für alle Geräte; ob ein Gerät überhaupt etwas
 * bekommt, entscheidet sein Push-Abo.
 */
export interface NotificationPrefs {
  /** Uhrzeit am Sendetag; daysBefore: 0 = am Tag, 1 = am Vortag, … (mehrere möglich). */
  birthdays: { enabled: boolean; time: string; daysBefore: number[] };
  /** Termine mit Uhrzeit: Vorlauf in Minuten. */
  events: { enabled: boolean; leadMinutes: number };
  /** ToDos mit Uhrzeit: Vorlauf; ganztägig fällige: gesammelt am Tag um allDayTime (null = aus). */
  todos: { enabled: boolean; leadMinutes: number; allDayTime: string | null };
  /** Learnweb-Abgaben: ein oder mehrere Vorläufe in Minuten. */
  learnweb: { enabled: boolean; leadMinutes: number[] };
  /** Tagesüberblick um diese Uhrzeit. */
  digest: { enabled: boolean; time: string };
}

export interface Preset<T> {
  value: T;
  label: string;
}

function times(values: string[]): Preset<string>[] {
  return values.map((value) => ({ value, label: value }));
}

function leads(values: number[]): Preset<number>[] {
  return values.map((value) => ({ value, label: leadLabel(value) }));
}

/** Vorlauf als kurzes Label: 0 → „Zur Fälligkeit", 30 → „30 Min", 120 → „2 Std", 1440 → „1 Tag". */
export function leadLabel(minutes: number): string {
  if (minutes === 0) return 'Zur Fälligkeit';
  if (minutes % 1440 === 0) return minutes === 1440 ? '1 Tag' : `${minutes / 1440} Tage`;
  if (minutes % 60 === 0) return `${minutes / 60} Std`;
  return `${minutes} Min`;
}

/** Die wählbaren Werte je Einstellung. Nur diese Werte übersteht normalizePrefs. */
export const PRESETS = {
  birthdayTime: times(['07:00', '08:00', '09:00', '12:00', '18:00']),
  birthdayDaysBefore: [
    { value: 0, label: 'Am Tag' },
    { value: 1, label: 'Am Vortag' },
    { value: 3, label: '3 Tage vorher' },
    { value: 7, label: '1 Woche vorher' },
  ] as Preset<number>[],
  eventLead: leads([5, 10, 15, 30, 60, 120]),
  todoLead: leads([0, 15, 30, 60]),
  todoAllDayTime: [{ value: null, label: 'Aus' }, ...times(['07:00', '08:00', '09:00', '12:00'])] as Preset<string | null>[],
  learnwebLead: leads([60, 180, 1440, 2880]),
  digestTime: times(['06:30', '07:00', '07:30', '08:00', '09:00']),
};

/**
 * Was ohne gespeicherte Auswahl gilt: Geburtstage an, Termine und ToDos mit Uhrzeit 30 Minuten vorher, alles Weitere aus.
 */
export const DEFAULT_PREFS: NotificationPrefs = {
  birthdays: { enabled: true, time: '08:00', daysBefore: [0] },
  events: { enabled: true, leadMinutes: 30 },
  todos: { enabled: true, leadMinutes: 30, allDayTime: null },
  learnweb: { enabled: false, leadMinutes: [1440] },
  digest: { enabled: false, time: '07:30' },
};

function section(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pick<T>(presets: Preset<T>[], value: unknown, fallback: T): T {
  return presets.some((p) => p.value === value) ? (value as T) : fallback;
}

/** Gültige Werte in Preset-Reihenfolge, ohne Dubletten; leer → Fallback. */
function pickMany<T>(presets: Preset<T>[], value: unknown, fallback: T[]): T[] {
  if (!Array.isArray(value)) return [...fallback];
  const chosen = presets.map((p) => p.value).filter((v) => value.includes(v));
  return chosen.length ? chosen : [...fallback];
}

/**
 * Gespeichertes JSON → vollständige, gültige Auswahl. Fehlendes oder
 * Ungültiges fällt feldweise auf DEFAULT_PREFS zurück, damit Tick und UI nie
 * mit halben oder fremden Werten rechnen.
 */
export function normalizePrefs(raw: unknown): NotificationPrefs {
  const r = section(raw);
  const b = section(r.birthdays);
  const e = section(r.events);
  const t = section(r.todos);
  const l = section(r.learnweb);
  const d = section(r.digest);
  const D = DEFAULT_PREFS;
  return {
    birthdays: {
      enabled: bool(b.enabled, D.birthdays.enabled),
      time: pick(PRESETS.birthdayTime, b.time, D.birthdays.time),
      daysBefore: pickMany(PRESETS.birthdayDaysBefore, b.daysBefore, D.birthdays.daysBefore),
    },
    events: {
      enabled: bool(e.enabled, D.events.enabled),
      leadMinutes: pick(PRESETS.eventLead, e.leadMinutes, D.events.leadMinutes),
    },
    todos: {
      enabled: bool(t.enabled, D.todos.enabled),
      leadMinutes: pick(PRESETS.todoLead, t.leadMinutes, D.todos.leadMinutes),
      allDayTime: pick(PRESETS.todoAllDayTime, t.allDayTime, D.todos.allDayTime),
    },
    learnweb: {
      enabled: bool(l.enabled, D.learnweb.enabled),
      leadMinutes: pickMany(PRESETS.learnwebLead, l.leadMinutes, D.learnweb.leadMinutes),
    },
    digest: {
      enabled: bool(d.enabled, D.digest.enabled),
      time: pick(PRESETS.digestTime, d.time, D.digest.time),
    },
  };
}

// ---------------------------------------------------------------------------
// Zeit in Europe/Berlin
// ---------------------------------------------------------------------------

/** Vorlauf-Erinnerungen, deren Zeitpunkt so lange her ist, holt ein Tick noch nach. */
export const LEAD_GRACE_MS = 15 * MIN;
/** Uhrzeit-Presets (Geburtstage, Tagesüberblick, Tages-ToDos) dürfen so spät noch kommen. */
export const DAILY_GRACE_MS = 60 * MIN;

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: NOTIFICATION_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

function berlinParts(ms: number) {
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Kalendertag (YYYY-MM-DD) eines Zeitpunkts in Berlin. */
export function berlinDate(ms: number): string {
  const { y, m, d } = berlinParts(ms);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Abstand Berlin–UTC zum Zeitpunkt ms (1 h im Winter, 2 h im Sommer). */
function berlinOffset(ms: number): number {
  const { y, m, d, hh, mm, ss } = berlinParts(ms);
  return Date.UTC(y, m - 1, d, hh, mm, ss) - Math.floor(ms / 1000) * 1000;
}

/**
 * Zeitpunkt (ms) einer Berliner Wanduhrzeit an einem Tag. In der
 * Umstellungsnacht, in der die Stunde fehlt oder doppelt ist, trifft es einen
 * der beiden Kandidaten — die Presets liegen tagsüber.
 */
export function berlinWallTime(ymd: string, hhmm: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const asUTC = Date.UTC(y, m - 1, d, hh, mm);
  const guess = asUTC - berlinOffset(asUTC);
  return asUTC - berlinOffset(guess);
}

/** Datum ± n Tage, rein kalendarisch (YYYY-MM-DD). */
export function addDaysYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Ist ein geplanter Versandzeitpunkt jetzt dran? fireAt ∈ (now − grace, now]. */
export function isDue(fireAt: number, now: number, graceMs: number): boolean {
  return fireAt <= now && fireAt > now - graceMs;
}

/**
 * ToDo-Fälligkeit um exakt 00:00 UTC gilt als ganztägig — dasselbe
 * Speichermodell wie isAllDayDue() in src/lib/format.
 */
export function isAllDayDue(iso: string): boolean {
  const d = new Date(iso);
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
}

// ---------------------------------------------------------------------------
// Termine
// ---------------------------------------------------------------------------

/** Termine ohne eigene Vorlauf-Nachricht: Status- und Blocker-Einträge statt Verabredungen. */
const QUIET_EVENT_TYPES = new Set(['birthday', 'workingLocation', 'outOfOffice', 'focusTime']);

/**
 * Bekommt dieser Termin eine Vorlauf-Nachricht? Nur eigene Kalender — beschreibbare
 * Google-Kalender und Kalender-Abos (schreibgeschützt, aber die eigenen Termine,
 * etwa der Arbeitskalender) —, nur mit Uhrzeit, keine ToDo-Spiegel — die ToDos
 * benachrichtigen selbst. Fremde Google-Kalender ohne Schreibrecht (Feiertage,
 * geteilte Kalender) bleiben still.
 */
export function isLeadNotifiable(
  e: Pick<CalendarEvent, 'calendar' | 'editable' | 'all_day' | 'todo_id' | 'start' | 'event_type'>,
): boolean {
  const own = e.editable || e.calendar === 'subscription';
  return own && !e.all_day && !e.todo_id && Boolean(e.start) && !QUIET_EVENT_TYPES.has(e.event_type ?? '');
}

/**
 * Gilt eine eigene Einstellung (reminders-Zeile) noch für einen Termin, der jetzt zu
 * `start` beginnt? Bei Google-Terminen immer. Ein verschobener Abo-Termin (calendar_id
 * `sub:…`) behält seine id; dort gilt „Aus" weiter, eine eigene Zeit aber nur, solange
 * der Beginn derselbe ist wie beim Setzen — sonst gilt wieder der Standard des Themas,
 * in der Glocke wie im Tick. (Präfix wie SUBSCRIPTION_ID_PREFIX in @larvis/shared, hier
 * als Text, weil die Functions keine Werte aus dem Workspace-Paket importieren.)
 */
export function reminderAppliesTo(
  row: { calendar_id: string | null; notify_at: string | null; start_at: string | null },
  start: string,
): boolean {
  if (!row.calendar_id?.startsWith('sub:') || row.notify_at === null) return true;
  return row.start_at !== null && Date.parse(row.start_at) === Date.parse(start);
}

// ---------------------------------------------------------------------------
// Geburtstage
// ---------------------------------------------------------------------------

/** Apples Platzhalterjahr für Geburtstage ohne Jahr (Kopie aus @larvis/shared/contacts). */
const BIRTHDAY_YEAR_PLACEHOLDER = 1604;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Fällt ein Geburtstag (YYYY-MM-DD) auf den Tag ymd? Der 29.2. zählt in Nicht-Schaltjahren am 28.2. */
export function birthdayFallsOn(birthday: string, ymd: string): boolean {
  const [, bm, bd] = birthday.split('-').map(Number);
  const [y, m, d] = ymd.split('-').map(Number);
  if (bm === 2 && bd === 29 && !isLeapYear(y)) return m === 2 && d === 28;
  return bm === m && bd === d;
}

/** Alter, das jemand am Tag ymd erreicht — null ohne bekanntes Geburtsjahr. */
export function ageOn(birthday: string, yearKnown: boolean, ymd: string): number | null {
  const birthYear = Number(birthday.slice(0, 4));
  if (!yearKnown || !birthYear || birthYear === BIRTHDAY_YEAR_PLACEHOLDER) return null;
  return Number(ymd.slice(0, 4)) - birthYear;
}

/** Überschrift der Geburtstags-Nachricht je Vorlauf in Tagen. */
export function birthdayHeadline(daysBefore: number): string {
  if (daysBefore === 0) return 'Heute Geburtstag';
  if (daysBefore === 1) return 'Morgen Geburtstag';
  if (daysBefore === 7) return 'In einer Woche Geburtstag';
  return `In ${daysBefore} Tagen Geburtstag`;
}

// ---------------------------------------------------------------------------
// Versandprotokoll
// ---------------------------------------------------------------------------

const iso = (value: string) => new Date(value).toISOString();

/**
 * Schlüssel im Versandprotokoll: einer je Anlass. Bei Themen-Nachrichten ist
 * das Einfügen der Claim gegen Doppelversand. Zeitangaben sind auf UTC-ISO
 * normalisiert, damit „10:00+02:00" und „08:00Z" derselbe Anlass sind; ein
 * verschobener Termin ist ein neuer Anlass.
 */
export const notificationKey = {
  event: (calendarId: string, eventId: string, start: string) => `event:${calendarId}:${eventId}:${iso(start)}`,
  todo: (todoId: string, due: string) => `todo:${todoId}:${iso(due)}`,
  todosDay: (ymd: string) => `todos-day:${ymd}`,
  birthdays: (ymd: string, daysBefore: number) => `birthdays:${ymd}:${daysBefore}`,
  learnweb: (eventRowId: string, startsAt: string, leadMinutes: number) =>
    `learnweb:${eventRowId}:${iso(startsAt)}:${leadMinutes}`,
  digest: (ymd: string) => `digest:${ymd}`,
  reminder: (reminderId: string, notifyAt: string) => `reminder:${reminderId}:${iso(notifyAt)}`,
};
