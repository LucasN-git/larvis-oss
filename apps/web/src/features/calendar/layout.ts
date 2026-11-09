import { addDays, format, parseISO } from 'date-fns';
import type { CalendarEvent } from '@larvis/shared';

// Reine Layout-Rechnung für den Kalender: an welchen Tagen ein Termin liegt, wie
// Mehrtages-Termine als Balken über eine Woche laufen und wie sich überlappende
// Termine in der Tages-Zeitleiste nebeneinander stellen.

export const dayKey = (d: Date): string => format(d, 'yyyy-MM-dd');

export interface Span {
  /** Erster Tag des Termins (YYYY-MM-DD, lokal). */
  startKey: string;
  /** Letzter Tag des Termins, inklusiv. */
  endKey: string;
}

export interface SpannedEvent extends Span {
  ev: CalendarEvent;
}

/** Erster und letzter Tag eines Termins. Ganztägige Termine tragen ein exklusives Enddatum. */
export function eventSpan(ev: CalendarEvent): Span {
  const startRaw = ev.start;
  const endRaw = ev.end || ev.start;
  try {
    if (ev.all_day) {
      const startKey = startRaw.slice(0, 10);
      const endKey = dayKey(addDays(parseISO(endRaw.slice(0, 10)), -1));
      return { startKey, endKey: endKey < startKey ? startKey : endKey };
    }
    const s = parseISO(startRaw);
    const e = parseISO(endRaw);
    // Ein Ende um Punkt Mitternacht gehört noch zum Vortag.
    const last = new Date(Math.max(s.getTime(), e.getTime() - 1));
    return { startKey: dayKey(s), endKey: dayKey(last) };
  } catch {
    const key = startRaw.slice(0, 10);
    return { startKey: key, endKey: key };
  }
}

/** Tag, unter dem ein Termin einsortiert wird, wenn nur sein Beginn zählt. */
export function eventDayKey(ev: CalendarEvent): string {
  return eventSpan(ev).startKey;
}

export function withSpans(events: CalendarEvent[]): SpannedEvent[] {
  return events.map((ev) => ({ ev, ...eventSpan(ev) }));
}

export const coversDay = (s: Span, key: string): boolean => s.startKey <= key && key <= s.endKey;

/** Ganztägig oder über Mitternacht hinaus: läuft im Monatsraster als Balken. */
export const isBarEvent = (s: SpannedEvent): boolean => s.ev.all_day || s.startKey !== s.endKey;

const byStart = (a: CalendarEvent, b: CalendarEvent) =>
  Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start);

/** Alle Termine je Tag — ein Mehrtages-Termin steht unter jedem Tag, den er berührt. */
export function eventsByDay(spanned: SpannedEvent[], keys: string[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const key of keys) {
    const list = spanned
      .filter((s) => coversDay(s, key))
      // Ein Termin, der vom Vortag herüberläuft, steht oben wie ein ganztägiger.
      .sort((a, b) => Number(b.startKey < key) - Number(a.startKey < key) || byStart(a.ev, b.ev))
      .map((s) => s.ev);
    if (list.length) map.set(key, list);
  }
  return map;
}

/**
 * Geburtstage kommen auf zwei Wegen: als echter Google-Geburtstag (eventType) oder als
 * jährliche Serie aus einem Kontakt-Import, die nur am Titel erkennbar ist.
 */
export function isBirthday(ev: CalendarEvent): boolean {
  if (ev.event_type === 'birthday') return true;
  // Nur das ganze Wort: „Geburtstagsgeschenk kaufen" ist ein Termin, kein Geburtstag.
  return ev.all_day && /(^|[^\p{L}])(geburtstag|birthday)($|[^\p{L}])/iu.test(ev.summary);
}

/** „Geburtstag Max" → „Max"; der Rest des Titels ist der Name. */
export function birthdayName(ev: CalendarEvent): string {
  const name = ev.summary
    .replace(/\b(hat\s+)?geburtstag\b|\bbirthday\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–-]+|[\s:–-]+$/g, '');
  return name || ev.summary;
}

/**
 * Zeitangabe eines Termins für einen bestimmten Tag. An den Folgetagen eines
 * Mehrtages-Termins zählt nicht mehr sein Beginn, sondern wie lange er noch läuft.
 */
export function dayTimeLabel(ev: CalendarEvent, key: string): string {
  if (ev.all_day) return 'ganztägig';
  const { startKey, endKey } = eventSpan(ev);
  const hhmm = (iso: string) => format(parseISO(iso), 'HH:mm');
  if (startKey < key) return endKey > key ? 'ganztägig' : `bis ${hhmm(ev.end)}`;
  return endKey > key ? `ab ${hhmm(ev.start)}` : hhmm(ev.start);
}

// ---------- Monatsraster: Balken je Woche ----------

export interface WeekBar {
  ev: CalendarEvent;
  /** Erste Spalte in dieser Woche (0 = Montag). */
  col: number;
  span: number;
  lane: number;
  /** Der Termin hat vor dieser Woche begonnen bzw. läuft danach weiter. */
  startsBefore: boolean;
  endsAfter: boolean;
}

export interface WeekLayout {
  bars: WeekBar[];
  /** Zahl der belegten Balken-Zeilen. */
  lanes: number;
  /** Eintägige Termine mit Uhrzeit, je Spalte. */
  chips: CalendarEvent[][];
}

export function layoutWeek(weekKeys: string[], spanned: SpannedEvent[]): WeekLayout {
  const first = weekKeys[0];
  const last = weekKeys[weekKeys.length - 1];
  const inWeek = spanned.filter((s) => s.startKey <= last && s.endKey >= first);

  const barEvents = inWeek
    .filter(isBarEvent)
    // Frühere und längere Termine zuerst, damit lange Balken oben durchlaufen.
    .sort((a, b) => a.startKey.localeCompare(b.startKey) || b.endKey.localeCompare(a.endKey) || byStart(a.ev, b.ev));

  const laneEnd: number[] = []; // letzte belegte Spalte je Zeile
  const bars: WeekBar[] = barEvents.map((s) => {
    const col = s.startKey < first ? 0 : weekKeys.indexOf(s.startKey);
    const endCol = s.endKey > last ? weekKeys.length - 1 : weekKeys.indexOf(s.endKey);
    let lane = laneEnd.findIndex((end) => end < col);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = endCol;
    return {
      ev: s.ev,
      col,
      span: endCol - col + 1,
      lane,
      startsBefore: s.startKey < first,
      endsAfter: s.endKey > last,
    };
  });

  const chips = weekKeys.map((key) =>
    inWeek
      .filter((s) => !isBarEvent(s) && s.startKey === key)
      .map((s) => s.ev)
      .sort(byStart),
  );

  return { bars, lanes: laneEnd.length, chips };
}

// ---------- Tagesansicht: Zeitleiste ----------

export interface TimedBlock {
  ev: CalendarEvent;
  /** Minuten seit Mitternacht, auf den Tag beschnitten. */
  startMin: number;
  endMin: number;
  /** Spalte und Spaltenzahl innerhalb der Gruppe sich überlappender Termine. */
  column: number;
  columns: number;
  startsBefore: boolean;
  endsAfter: boolean;
}

export interface DayLayout {
  /** Ganztägige Termine und solche, die den ganzen Tag überdecken. */
  allDay: CalendarEvent[];
  timed: TimedBlock[];
}

const DAY_MIN = 24 * 60;

export function layoutDay(key: string, spanned: SpannedEvent[]): DayLayout {
  const dayStart = parseISO(key).getTime();
  const allDay: CalendarEvent[] = [];
  const raw: Omit<TimedBlock, 'column' | 'columns'>[] = [];

  for (const s of spanned) {
    if (!coversDay(s, key)) continue;
    if (s.ev.all_day) {
      allDay.push(s.ev);
      continue;
    }
    const startMin = Math.max(0, Math.round((parseISO(s.ev.start).getTime() - dayStart) / 60_000));
    const endMin = Math.min(DAY_MIN, Math.round((parseISO(s.ev.end || s.ev.start).getTime() - dayStart) / 60_000));
    if (startMin === 0 && endMin === DAY_MIN) {
      allDay.push(s.ev); // mittlerer Tag eines Mehrtages-Termins
      continue;
    }
    raw.push({
      ev: s.ev,
      startMin,
      endMin: Math.max(endMin, startMin + 1),
      startsBefore: s.startKey < key,
      endsAfter: s.endKey > key,
    });
  }

  raw.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  // Überlappende Termine bilden eine Gruppe und teilen sich deren Breite.
  const timed: TimedBlock[] = [];
  let group: TimedBlock[] = [];
  let groupEnd = -1;
  let columnEnds: number[] = [];
  const flush = () => {
    for (const b of group) b.columns = columnEnds.length;
    timed.push(...group);
    group = [];
    columnEnds = [];
  };
  for (const r of raw) {
    if (group.length && r.startMin >= groupEnd) flush();
    let column = columnEnds.findIndex((end) => end <= r.startMin);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = r.endMin;
    groupEnd = Math.max(groupEnd, r.endMin);
    group.push({ ...r, column, columns: 1 });
  }
  flush();

  allDay.sort(byStart);
  return { allDay, timed };
}
