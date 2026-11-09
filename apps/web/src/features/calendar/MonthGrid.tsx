import { useMemo } from 'react';
import { eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { de } from 'date-fns/locale';
import { clsx } from 'clsx';
import type { CalendarEvent } from '@larvis/shared';
import { dayKey, isBirthday, layoutWeek, withSpans } from './layout';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
/** Sichtbare Balken-Zeilen je Woche; was darüber liegt, zählt zu „+n mehr". */
const MAX_LANES = 3;
/** Balken und Zeit-Chips zusammen, die eine Zelle höchstens zeigt. */
const MAX_ROWS = 4;

interface Props {
  cursor: Date;
  events: CalendarEvent[];
  colorOf: (ev: CalendarEvent) => string;
  /** Ein Klick — auf die Zelle wie auf einen Termin — öffnet die Tagesansicht. */
  onSelectDay: (dateStr: string) => void;
}

const isDone = (ev: CalendarEvent) => Boolean(ev.todo_id && ev.summary.startsWith('✓'));

export function MonthGrid({ cursor, events, colorOf, onSelectDay }: Props) {
  const weeks = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [cursor]);

  const spanned = useMemo(() => withSpans(events), [events]);

  return (
    <div>
      <div className="cal-grid" style={{ marginBottom: 6 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">{w}</div>
        ))}
      </div>
      <div className="cal-weeks">
        {weeks.map((week) => {
          const keys = week.map(dayKey);
          const { bars, lanes, chips } = layoutWeek(keys, spanned);
          const shownLanes = Math.min(lanes, MAX_LANES);
          const chipRows = Math.max(2, MAX_ROWS - shownLanes);
          // Zeile 1 trägt die Tageszahl, danach die Balken, zuletzt die Zeit-Chips.
          const chipRow = shownLanes + 2;

          return (
            <div
              key={keys[0]}
              className="cal-week"
              // `repeat(0, …)` ist ungültiges CSS und würde die ganze Angabe verwerfen.
              style={{ gridTemplateRows: ['28px', ...Array(shownLanes).fill('auto'), 'minmax(0, 1fr)'].join(' ') }}
            >
              {week.map((day, col) => (
                <div
                  key={keys[col]}
                  className={clsx('cal-cell', !isSameMonth(day, cursor) && 'cal-cell--out', isToday(day) && 'cal-cell--today')}
                  style={{ gridColumn: col + 1, gridRow: `1 / ${chipRow + 1}` }}
                  onClick={() => onSelectDay(keys[col])}
                >
                  <span className="cal-cell__num">{format(day, 'd')}</span>
                </div>
              ))}

              {bars
                .filter((b) => b.lane < MAX_LANES)
                .map((b) => (
                  <div
                    key={b.ev.id}
                    className={clsx(
                      'cal-bar',
                      b.startsBefore && 'cal-bar--from-before',
                      b.endsAfter && 'cal-bar--to-after',
                      isDone(b.ev) && 'cal-chip--done',
                    )}
                    style={{
                      gridColumn: `${b.col + 1} / span ${b.span}`,
                      gridRow: b.lane + 2,
                      ['--chip-color' as string]: colorOf(b.ev),
                    }}
                    title={b.ev.summary}
                    onClick={(e) => {
                      // Der Balken liegt über mehreren Tagen — der angeklickte zählt.
                      const rect = e.currentTarget.getBoundingClientRect();
                      const offset = Math.floor(((e.clientX - rect.left) / rect.width) * b.span);
                      onSelectDay(keys[b.col + Math.min(b.span - 1, Math.max(0, offset))]);
                    }}
                  >
                    {isBirthday(b.ev) ? '🎂 ' : ''}
                    {!b.ev.all_day && !b.startsBefore && (
                      <span className="cal-chip__time">{format(parseISO(b.ev.start), 'HH:mm', { locale: de })} </span>
                    )}
                    {b.ev.summary}
                  </div>
                ))}

              {week.map((_, col) => {
                const hiddenBars = bars.filter((b) => b.lane >= MAX_LANES && b.col <= col && col < b.col + b.span).length;
                const dayChips = chips[col];
                const more = hiddenBars + Math.max(0, dayChips.length - chipRows);
                if (!dayChips.length && !more) return null;
                return (
                  <div
                    key={keys[col]}
                    className="cal-chips"
                    style={{ gridColumn: col + 1, gridRow: chipRow }}
                    onClick={() => onSelectDay(keys[col])}
                  >
                    {dayChips.slice(0, chipRows).map((ev) => (
                      <div
                        key={ev.id}
                        className={clsx('cal-chip', isDone(ev) && 'cal-chip--done')}
                        style={{ ['--chip-color' as string]: colorOf(ev) }}
                        title={ev.summary}
                      >
                        <span className="cal-chip__dot" />
                        <span className="cal-chip__time">{format(parseISO(ev.start), 'HH:mm', { locale: de })}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.summary}</span>
                      </div>
                    ))}
                    {more > 0 && <div className="cal-cell__more">+{more} mehr</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
