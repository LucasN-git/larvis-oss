// iCalendar-Feed → CalendarEvent[] für ein Zeitfenster.
//
// Die Datei wird einmal geparst (parseIcs) und danach je Anfrage nur für das angefragte
// Fenster ausgerechnet (expandIcs): Serien (RRULE/RDATE) laufen ab ihrem Beginn, bis
// das Fenster vorbei ist, EXDATE fällt heraus, eine abweichende Einzelinstanz
// (RECURRENCE-ID) ersetzt ihre Serieninstanz, abgesagte Termine (STATUS:CANCELLED)
// erscheinen nicht. Parser ist ical.js; die Umrechnung der Uhrzeiten nach UTC macht
// timezones.ts, damit Windows-Zonennamen aus Outlook stimmen.
import { createHash } from 'node:crypto';
import ICAL from 'ical.js';
import type { CalendarEvent } from '../types.js';
import { SUBSCRIPTION_ID_PREFIX } from '../calendar.js';
import { resolveIanaZone, wallClockToUtc } from './timezones.js';

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalTime = InstanceType<typeof ICAL.Time>;

/** Fehler mit einer Meldung, die so in der Oberfläche stehen darf (deutsch, ohne Link). */
export class IcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcsError';
  }
}

/** Ein geparster Feed: Termine nach UID gruppiert, bereit zum Ausrechnen. */
export interface ParsedCalendar {
  /** X-WR-CALNAME, falls der Feed einen Namen mitbringt. */
  name: string | null;
  /** Zone für Uhrzeiten ohne TZID (X-WR-TIMEZONE, sonst Europe/Berlin). */
  defaultZone: string;
  /** Anzahl VEVENTs, nur zur Auskunft. */
  eventCount: number;
  series: SeriesGroup[];
}

interface SeriesGroup {
  uid: string;
  /** Der Termin ohne RECURRENCE-ID (Einzeltermin oder Serie); fehlt bei verwaisten Ausnahmen. */
  master: IcalComponent | null;
  /** Abweichende Einzelinstanzen einer Serie (mit RECURRENCE-ID). */
  overrides: IcalComponent[];
}

/** Abo-Daten, die jeder Termin trägt. */
export interface SubscriptionMeta {
  id: string;
  name: string;
  color: string;
  /** Projekt des Abos; jeder Termin trägt es als project_id. */
  project_id?: string | null;
}

const DEFAULT_ZONE = 'Europe/Berlin';
const DAY_MS = 86_400_000;
/** Obergrenze je Serie, damit ein kaputtes RRULE (z. B. SECONDLY ohne Ende) nichts aufhält. */
const MAX_ITERATIONS = 50_000;
/** Obergrenze je Feed und Fenster. */
const MAX_EVENTS = 5_000;

/** Feed-Text parsen. Wirft IcsError, wenn es kein iCalendar ist. */
export function parseIcs(text: string): ParsedCalendar {
  const trimmed = text.replace(/^﻿/, '').trimStart();
  if (!/^BEGIN:VCALENDAR/i.test(trimmed)) {
    throw new IcsError('Unter dem Link liegt kein Kalender (keine iCalendar-Datei).');
  }
  let root: IcalComponent;
  try {
    root = new ICAL.Component(ICAL.parse(trimmed));
  } catch (e) {
    throw new IcsError(`Der Kalender ließ sich nicht lesen (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (root.name !== 'vcalendar') {
    throw new IcsError('Unter dem Link liegt kein Kalender (keine iCalendar-Datei).');
  }

  const calName = root.getFirstPropertyValue('x-wr-calname');
  const calZone = root.getFirstPropertyValue('x-wr-timezone');
  const defaultZone = resolveIanaZone(typeof calZone === 'string' ? calZone : null) ?? DEFAULT_ZONE;

  const groups = new Map<string, SeriesGroup>();
  const vevents = root.getAllSubcomponents('vevent');
  vevents.forEach((comp, index) => {
    const rawUid = comp.getFirstPropertyValue('uid');
    // Ohne UID (nicht RFC-konform, kommt vor) bekommt der Termin eine Ersatz-UID aus
    // Position und Inhalt, damit seine id zwischen zwei Abrufen gleich bleibt.
    const uid =
      typeof rawUid === 'string' && rawUid.trim()
        ? rawUid.trim()
        : `nouid-${index}-${hash(comp.toString()).slice(0, 8)}`;
    let group = groups.get(uid);
    if (!group) {
      group = { uid, master: null, overrides: [] };
      groups.set(uid, group);
    }
    if (comp.hasProperty('recurrence-id')) group.overrides.push(comp);
    else if (!group.master) group.master = comp;
  });

  return {
    name: typeof calName === 'string' && calName.trim() ? calName.trim() : null,
    defaultZone,
    eventCount: vevents.length,
    series: [...groups.values()],
  };
}

function hash(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function tzidOf(comp: IcalComponent, prop: string): string | null {
  const p = comp.getFirstProperty(prop);
  const v = p?.getParameter('tzid');
  return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : null;
}

/** ICAL.Time → UTC-Millisekunden. Reihenfolge: UTC, IANA/Windows-Name, VTIMEZONE aus dem Feed, Standardzone. */
function toUtcMs(t: IcalTime, tzid: string | null, defaultZone: string): number {
  if (t.zone === ICAL.Timezone.utcTimezone) return t.toUnixTime() * 1000;
  const wall = { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second };
  const iana = resolveIanaZone(tzid);
  if (iana) return wallClockToUtc(wall, iana);
  if (t.zone && t.zone !== ICAL.Timezone.localTimezone) return t.toUnixTime() * 1000;
  return wallClockToUtc(wall, defaultZone);
}

/** Datumsteil einer ICAL.Time als YYYY-MM-DD. */
function dateString(t: IcalTime): string {
  return `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

function textProp(comp: IcalComponent, name: string): string | null {
  const v = comp.getFirstPropertyValue(name);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function isCancelled(comp: IcalComponent): boolean {
  const s = comp.getFirstPropertyValue('status');
  return typeof s === 'string' && s.toUpperCase() === 'CANCELLED';
}

/** Länge eines Termins: Tage (ganztägig) bzw. Millisekunden (mit Uhrzeit). */
interface Span {
  allDay: boolean;
  days: number;
  ms: number;
}

function spanOf(comp: IcalComponent, start: IcalTime, defaultZone: string): Span {
  const allDay = start.isDate;
  const dtend = comp.getFirstPropertyValue('dtend');
  const duration = comp.getFirstPropertyValue('duration');
  if (allDay) {
    let days = 1;
    if (dtend instanceof ICAL.Time) days = dayDiff(dateString(start), dateString(dtend));
    else if (duration instanceof ICAL.Duration) days = Math.round(duration.toSeconds() / 86_400);
    return { allDay, days: Math.max(1, days), ms: 0 };
  }
  let ms = 0;
  if (dtend instanceof ICAL.Time) {
    ms = toUtcMs(dtend, tzidOf(comp, 'dtend'), defaultZone) - toUtcMs(start, tzidOf(comp, 'dtstart'), defaultZone);
  } else if (duration instanceof ICAL.Duration) {
    ms = duration.toSeconds() * 1000;
  }
  return { allDay, days: 0, ms: Math.max(0, ms) };
}

interface Instance {
  comp: IcalComponent;
  /** Beginn dieser Instanz (bei einer Ausnahme deren eigener). */
  start: IcalTime;
  /** TZID, in der `start` zu lesen ist. */
  tzid: string | null;
  span: Span;
  /** Schlüssel der Instanz innerhalb ihrer UID (ursprünglicher Beginn) — Teil der id. */
  key: string;
  recurring: boolean;
}

/** Beginn/Ende einer Instanz als CalendarEvent-Werte plus Millisekunden zum Fenstervergleich. */
function bounds(inst: Instance, defaultZone: string) {
  if (inst.span.allDay) {
    const start = dateString(inst.start);
    const end = addDays(start, inst.span.days);
    const wall = (d: string) => {
      const [y, m, day] = d.split('-').map(Number);
      return wallClockToUtc({ year: y, month: m, day, hour: 0, minute: 0, second: 0 }, defaultZone);
    };
    return { start, end, startMs: wall(start), endMs: wall(end) };
  }
  const startMs = toUtcMs(inst.start, inst.tzid, defaultZone);
  const endMs = startMs + inst.span.ms;
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), startMs, endMs };
}

function toEvent(
  inst: Instance,
  uid: string,
  sub: SubscriptionMeta,
  b: ReturnType<typeof bounds>,
): CalendarEvent {
  const url = textProp(inst.comp, 'url');
  const base = `${SUBSCRIPTION_ID_PREFIX}${sub.id}:`;
  return {
    id: base + hash(`${uid}|${inst.key}`).slice(0, 20),
    summary: textProp(inst.comp, 'summary') ?? '(ohne Titel)',
    description: textProp(inst.comp, 'description'),
    location: textProp(inst.comp, 'location'),
    start: b.start,
    end: b.end,
    all_day: inst.span.allDay,
    html_link: url && /^https?:\/\//i.test(url) ? url : null,
    calendar: 'subscription',
    calendar_id: `${SUBSCRIPTION_ID_PREFIX}${sub.id}`,
    calendar_name: sub.name,
    color: sub.color,
    editable: false,
    project_id: sub.project_id ?? null,
    place_id: null,
    tags: [],
    todo_id: null,
    event_type: null,
    recurring_event_id: inst.recurring ? base + hash(uid).slice(0, 20) : null,
  };
}

/**
 * Termine eines geparsten Feeds, die das Fenster [timeMin, timeMax) berühren, sortiert
 * nach Beginn. Fehlerhafte Einzeltermine werden übersprungen statt den Feed zu kippen.
 */
export function expandIcs(
  cal: ParsedCalendar,
  sub: SubscriptionMeta,
  timeMin: string | Date,
  timeMax: string | Date,
): CalendarEvent[] {
  const minMs = new Date(timeMin).getTime();
  const maxMs = new Date(timeMax).getTime();
  const out: CalendarEvent[] = [];
  const zone = cal.defaultZone;

  const emit = (inst: Instance, uid: string) => {
    if (out.length >= MAX_EVENTS) return;
    const b = bounds(inst, zone);
    // Überschneidung mit dem Fenster; ein Termin ohne Dauer zählt, wenn er darin beginnt.
    const overlaps = b.endMs > b.startMs ? b.endMs > minMs && b.startMs < maxMs : b.startMs >= minMs && b.startMs < maxMs;
    if (overlaps) out.push(toEvent(inst, uid, sub, b));
  };

  for (const group of cal.series) {
    try {
      expandGroup(group, zone, minMs, maxMs, emit);
    } catch {
      // Ein unlesbarer Termin (kaputtes RRULE, fehlendes DTSTART) fällt weg, der Rest bleibt.
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

function overrideInstance(ov: IcalComponent, defaultZone: string): Instance | null {
  const start = ov.getFirstPropertyValue('dtstart');
  const rid = ov.getFirstPropertyValue('recurrence-id');
  if (!(start instanceof ICAL.Time) || !(rid instanceof ICAL.Time)) return null;
  return {
    comp: ov,
    start,
    tzid: tzidOf(ov, 'dtstart'),
    span: spanOf(ov, start, defaultZone),
    key: recurrenceKey(rid, tzidOf(ov, 'recurrence-id'), defaultZone),
    recurring: true,
  };
}

/** Vergleichbarer Schlüssel einer Instanz: der ursprüngliche Beginn in UTC (ganztägig: Datum). */
function recurrenceKey(t: IcalTime, tzid: string | null, defaultZone: string): string {
  return t.isDate ? dateString(t) : new Date(toUtcMs(t, tzid, defaultZone)).toISOString();
}

function expandGroup(
  group: SeriesGroup,
  zone: string,
  minMs: number,
  maxMs: number,
  emit: (inst: Instance, uid: string) => void,
) {
  const { master, uid } = group;
  const overrides = new Map<string, IcalComponent>();
  for (const ov of group.overrides) {
    const rid = ov.getFirstPropertyValue('recurrence-id');
    if (rid instanceof ICAL.Time) overrides.set(recurrenceKey(rid, tzidOf(ov, 'recurrence-id'), zone), ov);
  }

  if (!master || isCancelled(master)) {
    // Verwaiste Ausnahmen (Serie fehlt im Feed) zeigen sich als Einzeltermine; eine
    // abgesagte Serie nimmt alle ihre Instanzen mit.
    if (!master) {
      for (const ov of overrides.values()) {
        if (isCancelled(ov)) continue;
        const inst = overrideInstance(ov, zone);
        if (inst) emit(inst, uid);
      }
    }
    return;
  }

  const dtstart = master.getFirstPropertyValue('dtstart');
  if (!(dtstart instanceof ICAL.Time)) return;
  const tzid = tzidOf(master, 'dtstart');
  const span = spanOf(master, dtstart, zone);
  const recurring = master.hasProperty('rrule') || master.hasProperty('rdate');

  if (!recurring) {
    emit({ comp: master, start: dtstart, tzid, span, key: 'single', recurring: false }, uid);
    return;
  }

  // Serie: ab DTSTART durchlaufen (RecurExpansion beachtet EXDATE), bis eine Instanz nach
  // dem Fenster beginnt. Ersetzte Instanzen kommen aus der Ausnahme.
  const handled = new Set<string>();
  const event = new ICAL.Event(master, { exceptions: [] });
  const it = event.iterator();
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const occ = it.next();
    if (!occ) break;
    const roughEnd = Date.UTC(occ.year, occ.month - 1, occ.day, occ.hour, occ.minute, occ.second) +
      (span.allDay ? span.days * DAY_MS : span.ms) + 2 * DAY_MS;
    if (roughEnd < minMs) continue;
    const occMs = occ.isDate
      ? wallClockToUtc({ year: occ.year, month: occ.month, day: occ.day, hour: 0, minute: 0, second: 0 }, zone)
      : toUtcMs(occ, tzid, zone);
    if (occMs >= maxMs) break;
    const key = recurrenceKey(occ, tzid, zone);
    const ov = overrides.get(key);
    if (ov) {
      handled.add(key);
      if (isCancelled(ov)) continue;
      const inst = overrideInstance(ov, zone);
      if (inst) emit(inst, uid);
      continue;
    }
    emit({ comp: master, start: occ, tzid, span, key, recurring: true }, uid);
  }

  // Ausnahmen, deren ursprüngliche Instanz vor oder hinter dem Fenster liegt, die aber ins
  // Fenster verschoben wurden.
  for (const [key, ov] of overrides) {
    if (handled.has(key) || isCancelled(ov)) continue;
    const inst = overrideInstance(ov, zone);
    if (inst) emit(inst, uid);
  }
}
