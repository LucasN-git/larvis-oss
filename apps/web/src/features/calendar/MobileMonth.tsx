import { useEffect, useMemo, useRef, useState } from 'react';
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { clsx } from 'clsx';
import { Maximize2, Plus } from 'lucide-react';
import type { CalendarEvent } from '@larvis/shared';
import { formatDateHeading } from '../../lib/format';
import { Button } from '../../components/ui';
import { dayKey, dayTimeLabel, eventsByDay, withSpans } from './layout';
import { AgendaRow } from './AgendaView';

// Handy-Monatsansicht: kompaktes Grid mit Punkten statt Text-Chips, darunter
// die Termine des angetippten Tages in voller Breite. Horizontal wischen
// blättert den Monat.
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MAX_DOTS = 3;

interface Props {
  cursor: Date;
  events: CalendarEvent[];
  colorOf: (ev: CalendarEvent) => string;
  onSelectEvent: (ev: CalendarEvent) => void;
  /** "+ Termin" für den ausgewählten Tag. */
  onCreateAt: (dateStr: string) => void;
  /** Ausgewählten Tag groß als Zeitleiste öffnen. */
  onOpenDay: (dateStr: string) => void;
  onSwipeMonth: (delta: 1 | -1) => void;
}

export function MobileMonth({ cursor, events, colorOf, onSelectEvent, onCreateAt, onOpenDay, onSwipeMonth }: Props) {
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const monthKey = format(cursor, 'yyyy-MM');
  const [selected, setSelected] = useState(() =>
    todayKey.startsWith(monthKey) ? todayKey : `${monthKey}-01`,
  );

  // Monatswechsel: Auswahl auf heute (falls sichtbar), sonst den 1. setzen.
  useEffect(() => {
    setSelected(todayKey.startsWith(monthKey) ? todayKey : `${monthKey}-01`);
  }, [monthKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  // Ein Mehrtages-Termin zählt an jedem Tag, den er berührt.
  const byDay = useMemo(() => eventsByDay(withSpans(events), days.map(dayKey)), [events, days]);

  // Horizontales Wischen blättert den Monat (data-noswipe hält den Tab-Swipe raus).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) onSwipeMonth(dx < 0 ? 1 : -1);
  };

  const selectedEvents = byDay.get(selected) ?? [];

  return (
    <div data-noswipe onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="mcal-grid" style={{ marginBottom: 4 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">{w}</div>
        ))}
      </div>
      <div className="mcal-grid">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayEvents = byDay.get(key) ?? [];
          return (
            <button
              key={key}
              className={clsx(
                'mcal-day',
                !isSameMonth(day, cursor) && 'mcal-day--out',
                isToday(day) && 'mcal-day--today',
                key === selected && 'mcal-day--selected',
              )}
              onClick={() => setSelected(key)}
            >
              <span className="mcal-day__num">{format(day, 'd')}</span>
              <span className="mcal-day__dots">
                {dayEvents.slice(0, MAX_DOTS).map((ev) => (
                  <span key={ev.id} className="mcal-day__dot" style={{ background: colorOf(ev) }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mcal-daypanel">
        <div className="row between center mcal-daypanel__head">
          <div className="agenda-day__heading">{formatDateHeading(selected)}</div>
          <div className="row gap-xs center">
            <Button size="sm" variant="ghost" onClick={() => onOpenDay(selected)}>
              <Maximize2 size={14} /> Tag
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onCreateAt(selected)}>
              <Plus size={15} /> Termin
            </Button>
          </div>
        </div>
        {/* Termine des Tages als Gruppe, Tageslabel steht darüber. */}
        <div className="group agenda-group">
          {selectedEvents.length === 0 ? (
            <div className="group__empty">Keine Termine.</div>
          ) : (
            selectedEvents.map((ev) => (
              <AgendaRow key={ev.id} ev={ev} color={colorOf(ev)} time={dayTimeLabel(ev, selected)} onSelect={onSelectEvent} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
