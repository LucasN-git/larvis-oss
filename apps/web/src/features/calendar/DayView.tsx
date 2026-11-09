import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { clsx } from 'clsx';
import type { CalendarEvent } from '@larvis/shared';
import { isBirthday, layoutDay, withSpans } from './layout';

// Tagesansicht: oben die ganztägigen Termine, darunter eine Zeitleiste von 0 bis
// 24 Uhr, auf der jeder Termin so hoch ist, wie er dauert. Erst ein Klick auf
// einen Termin hier öffnet den Editor.
const HOUR_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** Beim Öffnen steht die Leiste auf dem Morgen, nicht auf Mitternacht. */
const SCROLL_TO_HOUR = 7;
const MIN_BLOCK_MIN = 25;

interface Props {
  day: string; // YYYY-MM-DD
  events: CalendarEvent[];
  colorOf: (ev: CalendarEvent) => string;
  onSelectEvent: (ev: CalendarEvent) => void;
  onCreateAt: (dateStr: string) => void;
}

const hhmm = (iso: string) => format(parseISO(iso), 'HH:mm');

export function DayView({ day, events, colorOf, onSelectEvent, onCreateAt }: Props) {
  const { allDay, timed } = useMemo(() => layoutDay(day, withSpans(events)), [day, events]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = SCROLL_TO_HOUR * HOUR_PX;
  }, [day]);

  // Die Jetzt-Linie wandert mit, solange der heutige Tag offen ist.
  const isCurrentDay = day === format(new Date(), 'yyyy-MM-dd');
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  useEffect(() => {
    if (!isCurrentDay) return;
    const t = setInterval(() => setNowMin(new Date().getHours() * 60 + new Date().getMinutes()), 60_000);
    return () => clearInterval(t);
  }, [isCurrentDay]);

  return (
    <div className="dayview">
      {allDay.length > 0 && (
        <div className="dayview__allday">
          <span className="dayview__allday-label">ganztägig</span>
          <div className="dayview__allday-list">
            {allDay.map((ev) => (
              <button
                key={ev.id}
                className="cal-bar dayview__allday-item"
                style={{ ['--chip-color' as string]: colorOf(ev) }}
                onClick={() => onSelectEvent(ev)}
              >
                {isBirthday(ev) ? '🎂 ' : ''}{ev.summary}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="dayview__scroller" ref={scroller}>
        <div className="dayview__timeline" style={{ height: 24 * HOUR_PX }} onClick={() => onCreateAt(day)}>
          {HOURS.map((h) => (
            <div key={h} className="dayview__hour" style={{ top: h * HOUR_PX }}>
              <span className="dayview__hour-label">{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}

          {isCurrentDay && <div className="dayview__now" style={{ top: (nowMin / 60) * HOUR_PX }} />}

          <div className="dayview__events">
            {timed.map((b) => {
              const height = (Math.max(b.endMin - b.startMin, MIN_BLOCK_MIN) / 60) * HOUR_PX;
              return (
                <button
                  key={b.ev.id}
                  className={clsx('dayview__block', height < 40 && 'dayview__block--short')}
                  style={{
                    top: (b.startMin / 60) * HOUR_PX,
                    height: height - 2,
                    left: `${(b.column / b.columns) * 100}%`,
                    width: `calc(${100 / b.columns}% - 4px)`,
                    ['--chip-color' as string]: colorOf(b.ev),
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEvent(b.ev);
                  }}
                >
                  <span className="dayview__block-title">{b.ev.summary}</span>
                  <span className="dayview__block-time">
                    {b.startsBefore ? '…' : hhmm(b.ev.start)} – {b.endsAfter ? '…' : hhmm(b.ev.end)}
                    {b.ev.location ? ` · ${b.ev.location}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
