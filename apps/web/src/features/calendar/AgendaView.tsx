import { useMemo, type ReactNode } from 'react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { clsx } from 'clsx';
import type { CalendarEvent } from '@larvis/shared';
import { formatDateHeading, formatEventTime } from '../../lib/format';
import { eventSpan, isBirthday } from './layout';

interface Props {
  events: CalendarEvent[];
  colorOf: (ev: CalendarEvent) => string;
  onSelectEvent: (ev: CalendarEvent) => void;
  /** Nur die ersten n Tage zeigen, an denen etwas ansteht (leere Tage zählen nicht mit). */
  limitDays?: number;
  /** Letzte Zeile in der Gruppe des letzten Tages, z. B. „Kalender öffnen". */
  footer?: ReactNode;
}

/** Uhrzeit bzw. „ganztägig"; bei Mehrtages-Terminen zusätzlich, bis wann sie laufen. */
function timeLabel(ev: CalendarEvent, todayKey: string): string {
  const { startKey, endKey } = eventSpan(ev);
  const started = startKey < todayKey;
  const head = ev.all_day ? (startKey === endKey ? 'ganztägig' : '') : started ? 'läuft' : formatEventTime(ev.start, false);
  if (startKey === endKey) return head;
  const until = `bis ${format(parseISO(endKey), 'EEEEEE d.M.', { locale: de })}`;
  return head ? `${head} · ${until}` : until;
}

// Je Tag eine Gruppe: Tageslabel über dem Rahmen, darin die Termine als flache
// Zeilen mit Hairlines. Dieselbe Form nutzen Handy-Monat und Geburtstage.
export function AgendaView({ events, colorOf, onSelectEvent, limitDays, footer }: Props) {
  // Agenda only shows today and the future; past days live in the month view.
  const todayKey = format(new Date(), 'yyyy-MM-dd');

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const { startKey, endKey } = eventSpan(ev);
      if (endKey < todayKey) continue;
      // Ein laufender Mehrtages-Termin steht unter heute, nicht unter seinem vergangenen Beginn.
      const key = startKey < todayKey ? todayKey : startKey;
      (map.get(key) ?? map.set(key, []).get(key)!).push(ev);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, evs]) => [day, evs.sort((a, b) => a.start.localeCompare(b.start))] as const);
  }, [events, todayKey]);

  const upcoming = grouped.filter(([day]) => day >= todayKey);
  const visible = limitDays != null ? upcoming.slice(0, limitDays) : upcoming;

  if (visible.length === 0) {
    return (
      <div className="group agenda-group">
        <div className="group__empty">Keine kommenden Termine.</div>
        {footer}
      </div>
    );
  }

  return (
    <div className="stack-section">
      {visible.map(([day, evs], i) => (
        <section key={day} className="agenda-day">
          <div className="agenda-day__heading">{formatDateHeading(day)}</div>
          <div className="group agenda-group">
            {evs.map((ev) => (
              <AgendaRow key={ev.id} ev={ev} color={colorOf(ev)} time={timeLabel(ev, todayKey)} onSelect={onSelectEvent} />
            ))}
            {i === visible.length - 1 && footer}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Eine flache Terminzeile in einer Tagesgruppe (auch im Handy-Monat). */
export function AgendaRow({
  ev,
  color,
  time,
  onSelect,
}: {
  ev: CalendarEvent;
  color: string;
  time: string;
  onSelect: (ev: CalendarEvent) => void;
}) {
  return (
    <button
      type="button"
      className="agenda-row"
      style={{ ['--chip-color' as string]: color }}
      onClick={() => onSelect(ev)}
    >
      <span className="agenda-row__bar" />
      <span className="agenda-row__time">{time}</span>
      {/* Titel + Ort gestapelt — nebeneinander quetscht auf dem Handy
          den Titel und bricht Wörter mittendrin um. */}
      <span className="agenda-row__main">
        <span className={clsx('agenda-row__title', ev.todo_id && ev.summary.startsWith('✓') && 'done-text')}>
          {isBirthday(ev) ? '🎂 ' : ''}{ev.summary}
        </span>
        {ev.location && <span className="agenda-row__loc">📍 {ev.location}</span>}
      </span>
    </button>
  );
}
