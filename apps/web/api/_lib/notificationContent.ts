// Auswahlregeln und Texte des Minuten-Ticks als reine Funktionen: in welchem
// Zeitfenster gesucht wird, welche Termine eine Nachricht bekommen, wie
// Geburtstage aus Kontakten und Google zusammenfinden und wie die Nachrichten
// lauten. Keine Supabase-, Google- oder Push-Aufrufe — die orchestriert
// api/notifications/tick.ts; so bleibt alles hier ohne Netz testbar.
import type { CalendarEvent } from '@larvis/shared';
import {
  NOTIFICATION_TZ,
  addDaysYMD,
  ageOn,
  berlinDate,
  berlinWallTime,
  birthdayFallsOn,
  isAllDayDue,
  isDue,
} from './notificationPrefs.js';

const MIN = 60_000;

export interface TimeWindow {
  /** ISO-Zeitpunkt, untere Grenze. */
  from: string;
  /** ISO-Zeitpunkt, obere Grenze. */
  to: string;
}

const toISO = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Zeitfenster
// ---------------------------------------------------------------------------

/**
 * Suchfenster für Anlässe mit Vorlauf. Ein Beginn b ist fällig, wenn
 * b − lead ∈ (now − grace, now], also b ∈ (now − grace + lead, now + lead].
 * Über mehrere Vorläufe spannt das Fenster vom kleinsten bis zum größten. Oben
 * liegt eine Minute Rand, weil Googles timeMax exklusiv ist; das genaue
 * Fälligsein entscheidet danach dueLeads.
 */
export function leadWindow(now: number, leadMinutes: number[], graceMs: number): TimeWindow {
  const minLead = Math.min(...leadMinutes) * MIN;
  const maxLead = Math.max(...leadMinutes) * MIN;
  return { from: toISO(now - graceMs + minLead), to: toISO(now + maxLead + MIN) };
}

/** Die Vorläufe, deren Versandzeitpunkt (Beginn − Vorlauf) jetzt dran ist. */
export function dueLeads(startISO: string, leadMinutes: number[], now: number, graceMs: number): number[] {
  const start = Date.parse(startISO);
  return leadMinutes.filter((lead) => isDue(start - lead * MIN, now, graceMs));
}

/** Der Berliner Kalendertag ymd als Zeitfenster [00:00, nächster Tag 00:00). */
export function berlinDayWindow(ymd: string): TimeWindow {
  return {
    from: toISO(berlinWallTime(ymd, '00:00')),
    to: toISO(berlinWallTime(addDaysYMD(ymd, 1), '00:00')),
  };
}

/**
 * Ein Kalenderfenster für alle Geburtstags-Zieltage: vom Berliner Beginn heute
 * bis zum Beginn des Tags nach dem spätesten Zieltag (heute + max(daysBefore)).
 * Es beginnt immer heute, damit der Tagesüberblick denselben Abruf mitnutzt;
 * je Zieltag filtert danach googleBirthdaysOn.
 */
export function birthdayWindow(today: string, daysBefore: number[]): TimeWindow {
  const lastDay = addDaysYMD(today, Math.max(0, ...daysBefore));
  return { from: berlinDayWindow(today).from, to: berlinDayWindow(lastDay).to };
}

// ---------------------------------------------------------------------------
// Termine
// ---------------------------------------------------------------------------

/** Im Tagesüberblick fehlen nur Geburtstage (eigener Teil) und Arbeitsorte. */
const DIGEST_HIDDEN_EVENT_TYPES = new Set(['birthday', 'workingLocation']);

/**
 * Termine am Berliner Tag ymd für den Tagesüberblick, ganztägige zuerst, dann
 * nach Uhrzeit. Ganztägige zählen an jedem Tag ihrer Spanne (Ende exklusiv),
 * getimte an ihrem Beginn-Tag.
 */
export function eventsOnDay(events: CalendarEvent[], ymd: string): CalendarEvent[] {
  return events
    .filter((e) => {
      if (!e.start || e.todo_id || DIGEST_HIDDEN_EVENT_TYPES.has(e.event_type ?? '')) return false;
      if (!e.all_day) return berlinDate(Date.parse(e.start)) === ymd;
      const first = e.start.slice(0, 10);
      const end = e.end ? e.end.slice(0, 10) : addDaysYMD(first, 1);
      return first <= ymd && ymd < end;
    })
    .sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return a.all_day ? a.start.localeCompare(b.start) : Date.parse(a.start) - Date.parse(b.start);
    });
}

/** Summaries der Google-Geburtstage, die am Tag ymd beginnen. */
export function googleBirthdaysOn(events: CalendarEvent[], ymd: string): string[] {
  return events.filter((e) => e.event_type === 'birthday' && e.start.slice(0, 10) === ymd).map((e) => e.summary);
}

// ---------------------------------------------------------------------------
// Geburtstage
// ---------------------------------------------------------------------------

export interface BirthdayContact {
  first_name: string;
  last_name: string;
  nickname: string | null;
  birthday: string | null;
  birthday_year_known: boolean;
}

export interface BirthdayPerson {
  name: string;
  /** Alter am Geburtstag, null ohne bekanntes Geburtsjahr (Google-Einträge immer). */
  age: number | null;
}

/** Anzeigename wie contactName() in @larvis/shared: „Vorname Nachname", notfalls Spitzname. */
export function contactDisplayName(c: Pick<BirthdayContact, 'first_name' | 'last_name' | 'nickname'>): string {
  const full = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return full || c.nickname || '(ohne Namen)';
}

const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Meint dieser Google-Geburtstag den Kontakt? Groß/Klein egal: die Summary
 * enthält den vollen Namen als ganze Wörter („Geburtstag von Anna Schmidt")
 * oder ist genau der Spitzname. Ganze Wörter, damit „Anna" nicht „Annalena" schluckt.
 */
export function matchesContact(
  summary: string,
  c: Pick<BirthdayContact, 'first_name' | 'last_name' | 'nickname'>,
): boolean {
  const s = normName(summary);
  const full = normName([c.first_name, c.last_name].filter(Boolean).join(' '));
  if (full && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(full)}($|[^\\p{L}\\p{N}])`, 'u').test(s)) return true;
  return Boolean(c.nickname && normName(c.nickname) && normName(c.nickname) === s);
}

/**
 * Wer am Tag ymd Geburtstag hat: Kontakte mit Alter, dazu Google-Geburtstage,
 * die keinem dieser Kontakte entsprechen und nicht schon genannt sind.
 */
export function birthdayPeople(contacts: BirthdayContact[], googleSummaries: string[], ymd: string): BirthdayPerson[] {
  const onDay = contacts.filter((c) => c.birthday && birthdayFallsOn(c.birthday, ymd));
  const people: BirthdayPerson[] = onDay.map((c) => ({
    name: contactDisplayName(c),
    age: ageOn(c.birthday!, c.birthday_year_known, ymd),
  }));
  const seen = new Set<string>();
  for (const summary of googleSummaries) {
    const name = summary.trim();
    const key = normName(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    if (onDay.some((c) => matchesContact(name, c))) continue;
    people.push({ name, age: null });
  }
  return people;
}

/** „Anna Schmidt (30), Ben" */
export function birthdayPeopleText(people: BirthdayPerson[]): string {
  return people.map((p) => (p.age === null ? p.name : `${p.name} (${p.age})`)).join(', ');
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: NOTIFICATION_TZ });
const whenFmt = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: NOTIFICATION_TZ,
});

/** Berliner Uhrzeit „09:00". */
export function fmtTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** Berliner Datum mit Uhrzeit „16. Sept., 23:59". */
export function fmtWhen(iso: string): string {
  return whenFmt.format(new Date(iso));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** „A, B, C, D +2": höchstens max Einträge, der Rest als Zähler. */
export function shortList(items: string[], max = 4): string {
  const shown = items.slice(0, max).join(', ');
  const rest = items.length - max;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

/** Termin mit Vorlauf: „09:00 · Raum 1". */
export function eventBody(start: string, location: string | null): string {
  return location ? `${fmtTime(start)} · ${location}` : fmtTime(start);
}

/** ToDo mit Uhrzeit: „Fällig 14:30", bei Vorlauf 0 „Jetzt fällig". */
export function todoLeadBody(dueISO: string, leadMinutes: number): string {
  return leadMinutes === 0 ? 'Jetzt fällig' : `Fällig ${fmtTime(dueISO)}`;
}

/** Ganztägig fällige ToDos gesammelt: „3 ToDos: A, B, C". */
export function todosDayBody(titles: string[]): string {
  return `${plural(titles.length, 'ToDo', 'ToDos')}: ${shortList(titles.map((t) => t || 'ToDo'))}`;
}

/** Learnweb-Abgabe: „ML · fällig 16. Sept., 23:59". */
export function learnwebBody(shortname: string | null, startsAt: string): string {
  return shortname ? `${shortname} · fällig ${fmtWhen(startsAt)}` : `Fällig ${fmtWhen(startsAt)}`;
}

/** Eigene Erinnerung an ein ToDo: Uhrzeit, wenn es eine hat. */
export function reminderTodoBody(dueAt: string | null): string {
  return dueAt && !isAllDayDue(dueAt) ? `Fällig ${fmtTime(dueAt)}` : 'Erinnerung';
}

/** Eigene Erinnerung an einen Termin: Datum und Uhrzeit aus dem gespeicherten Snapshot. */
export function reminderEventBody(startAt: string | null): string {
  return startAt ? fmtWhen(startAt) : 'Erinnerung';
}

/** Termin-Teil des Tagesüberblicks: „3 Termine, erster 09:00 Vorlesung". Erwartet eventsOnDay-Reihenfolge. */
function digestEventsText(events: CalendarEvent[]): string | null {
  if (!events.length) return null;
  const count = plural(events.length, 'Termin', 'Termine');
  const firstTimed = events.find((e) => !e.all_day);
  if (!firstTimed) return `${count}: ${shortList(events.map((e) => e.summary), 3)}`;
  const first = `${fmtTime(firstTimed.start)} ${firstTimed.summary}`;
  return events.length === 1 ? `${count}: ${first}` : `${count}, erster ${first}`;
}

/**
 * Tagesüberblick: „3 Termine, erster 09:00 Vorlesung · 2 ToDos fällig · 🎂 Anna".
 * Ein nicht lesbarer Kalender steht vorn, damit der Tag nicht fälschlich leer wirkt.
 */
export function digestBody(parts: {
  events: CalendarEvent[];
  calendarFailed?: boolean;
  /** Mindestens eine Kalenderquelle fehlte, die übrigen Termine stehen in events. */
  calendarIncomplete?: boolean;
  todoCount: number;
  birthdayNames: string[];
}): string {
  const out: string[] = [];
  if (parts.calendarFailed) out.push('Termine nicht lesbar');
  else if (parts.calendarIncomplete) out.push('Termine teils nicht lesbar');
  const events = digestEventsText(parts.events);
  if (events) out.push(events);
  if (parts.todoCount > 0) out.push(`${plural(parts.todoCount, 'ToDo', 'ToDos')} fällig`);
  if (parts.birthdayNames.length) out.push(`🎂 ${shortList(parts.birthdayNames, 3)}`);
  return out.length ? out.join(' · ') : 'Heute steht nichts an.';
}
