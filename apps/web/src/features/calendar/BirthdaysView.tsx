import { useMemo } from 'react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import type { CalendarEvent } from '@larvis/shared';
import { birthdayName, isBirthday } from './layout';

// Alle Geburtstage der nächsten zwölf Monate, nach Monat gruppiert und ab heute
// sortiert. Dieselbe Person am selben Tag erscheint nur einmal, auch wenn sie in
// Google doppelt gepflegt ist. Je Monat eine Gruppe, das Monatslabel steht darüber.

interface Props {
  events: CalendarEvent[];
  onSelectEvent: (ev: CalendarEvent) => void;
}

interface Row {
  ev: CalendarEvent;
  name: string;
  date: Date;
  inDays: number;
  duplicates: number;
}

function untilLabel(days: number): string {
  if (days === 0) return 'heute';
  if (days === 1) return 'morgen';
  if (days < 14) return `in ${days} Tagen`;
  if (days < 60) return `in ${Math.round(days / 7)} Wochen`;
  return `in ${Math.round(days / 30)} Monaten`;
}

export function BirthdaysView({ events, onSelectEvent }: Props) {
  const months = useMemo(() => {
    const today = new Date();
    const seen = new Map<string, Row>();
    for (const ev of events) {
      if (!isBirthday(ev)) continue;
      const date = parseISO(ev.start.slice(0, 10));
      const inDays = differenceInCalendarDays(date, today);
      if (inDays < 0) continue;
      const name = birthdayName(ev);
      // Schlüssel ohne Jahr: das Jahresfenster erfasst einen heutigen Geburtstag ein zweites
      // Mal in zwölf Monaten — der nähere Termin gewinnt, und nur gleiche Tage zählen als doppelt.
      const key = `${ev.start.slice(5, 10)}|${name.toLowerCase()}`;
      const existing = seen.get(key);
      if (!existing) seen.set(key, { ev, name, date, inDays, duplicates: 0 });
      else if (existing.inDays === inDays) existing.duplicates += 1;
      else if (inDays < existing.inDays) seen.set(key, { ev, name, date, inDays, duplicates: 0 });
    }
    const rows = [...seen.values()].sort((a, b) => a.inDays - b.inDays);
    const grouped = new Map<string, Row[]>();
    for (const r of rows) {
      const label = format(r.date, 'LLLL yyyy', { locale: de });
      (grouped.get(label) ?? grouped.set(label, []).get(label)!).push(r);
    }
    return [...grouped.entries()];
  }, [events]);

  if (months.length === 0) {
    return (
      <div className="group">
        <div className="group__empty">Keine Geburtstage im Kalender.</div>
      </div>
    );
  }

  return (
    <div className="stack-section">
      {months.map(([label, rows]) => (
        <section key={label} className="agenda-day">
          <div className="agenda-day__heading">{label}</div>
          <div className="group bday-group">
            {rows.map((r) => (
              <button type="button" key={r.ev.id} className="agenda-row bday-row" onClick={() => onSelectEvent(r.ev)}>
                <span className="bday-row__date">
                  <span className="bday-row__day">{format(r.date, 'd')}</span>
                  <span className="bday-row__weekday">{format(r.date, 'EEE', { locale: de })}</span>
                </span>
                <span className="agenda-row__main">
                  <span className="agenda-row__title">🎂 {r.name}</span>
                  {r.duplicates > 0 && <span className="agenda-row__loc">{r.duplicates + 1}× im Google-Kalender eingetragen</span>}
                </span>
                <span className={r.inDays <= 7 ? 'bday-row__until bday-row__until--soon' : 'bday-row__until'}>
                  {untilLabel(r.inDays)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
