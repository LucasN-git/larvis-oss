import { addDays, endOfDay, parseISO, startOfDay } from 'date-fns';
import type { CalendarEvent } from '@larvis/shared';
import { coversDay, dayKey, eventSpan } from './layout';

// Reine Rechnung für die Tafel-Ansicht: ein Tag als Abfahrtstafel. Jeder Termin mit
// Uhrzeit ist eine Abfahrt, die läuft (LIVE), noch kommt oder schon weg ist;
// ganztägige Termine stehen gesondert, weil sie keine Abfahrtszeit haben.

export type DepartureState = 'live' | 'upcoming' | 'departed';

export interface BoardRow {
  ev: CalendarEvent;
  /** Beginn bzw. Ende des Termins, auf den Tag beschnitten (epoch ms). */
  start: number;
  end: number;
  /** Echtes, unbeschnittenes Ende (epoch ms) — daran hängt die Restzeit eines laufenden Termins. */
  until: number;
  state: DepartureState;
  /** Anteil der verstrichenen Zeit eines laufenden Termins, 0–1. */
  progress: number;
}

export interface Board {
  allDay: CalendarEvent[];
  /** Laufende zuerst (die bald endende oben), dann kommende nach Abfahrt. */
  rows: BoardRow[];
  departed: BoardRow[];
}

export function buildBoard(events: CalendarEvent[], key: string, now: number): Board {
  const dayStart = startOfDay(parseISO(key)).getTime();
  const dayEnd = endOfDay(parseISO(key)).getTime() + 1;
  const allDay: CalendarEvent[] = [];
  const live: BoardRow[] = [];
  const upcoming: BoardRow[] = [];
  const departed: BoardRow[] = [];

  for (const ev of events) {
    if (!coversDay(eventSpan(ev), key)) continue;
    if (ev.all_day) {
      allDay.push(ev);
      continue;
    }
    const rawStart = parseISO(ev.start).getTime();
    const rawEnd = parseISO(ev.end || ev.start).getTime();
    const start = Math.max(rawStart, dayStart);
    const end = Math.max(start, Math.min(rawEnd, dayEnd));
    // Der Status hängt an der echten Dauer, nicht am beschnittenen Tagesausschnitt:
    // ein Termin über Mitternacht läuft auch dann, wenn der Tag schon gewechselt hat.
    const state: DepartureState = rawEnd <= now ? 'departed' : rawStart <= now ? 'live' : 'upcoming';
    const progress = state === 'live' && rawEnd > rawStart ? (now - rawStart) / (rawEnd - rawStart) : 0;
    const row = { ev, start, end, until: rawEnd, state, progress };
    (state === 'live' ? live : state === 'upcoming' ? upcoming : departed).push(row);
  }

  live.sort((a, b) => a.end - b.end);
  upcoming.sort((a, b) => a.start - b.start);
  departed.sort((a, b) => a.start - b.start);
  allDay.sort((a, b) => a.summary.localeCompare(b.summary));
  return { allDay, rows: [...live, ...upcoming], departed };
}

/** Restzeit wie auf einer Anzeigetafel: Minuten unter einer Stunde, sonst Stunden:Minuten. */
export function countdown(ms: number): { value: string; unit: string } {
  const min = Math.max(0, Math.ceil(ms / 60_000));
  if (min < 60) return { value: String(min), unit: 'min' };
  const h = Math.floor(min / 60);
  return { value: `${h}:${String(min % 60).padStart(2, '0')}`, unit: 'std' };
}

/** Die sieben Tage einer Woche ab ihrem Montag. */
export function weekKeys(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => dayKey(addDays(weekStart, i)));
}
