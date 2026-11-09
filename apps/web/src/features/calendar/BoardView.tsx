import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { de } from 'date-fns/locale';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CalendarEvent, Project } from '@larvis/shared';
import { buildBoard, countdown, weekKeys, type Board, type BoardRow } from './board';
import { coversDay, dayKey, eventSpan, isBirthday } from './layout';
import { BoardWidgets } from './BoardWidgets';
import { useNow } from '../../lib/useNow';

// Der Kalender als U-Bahn-Abfahrtstafel: ein Tag, jeder Termin eine Abfahrt mit
// Linien-Badge (Projekt bzw. Kalender), rechts die Restzeit. Laufende Termine stehen
// oben, der erste davon hervorgehoben; daneben Widgets im LED-Look. Kopf und Widgets
// folgen dem Theme: hell = Schild, dunkel = Nachtanzeige (Farben in calendar.css).

interface Props {
  /** Gewählter Tag (YYYY-MM-DD); die Woche darum wird geladen. */
  day: string;
  events: CalendarEvent[];
  /** Termine der Woche werden noch geladen (leere Liste heißt dann nicht „frei"). */
  loading: boolean;
  projects: Project[];
  colorOf: (ev: CalendarEvent) => string;
  onSelectDay: (day: string) => void;
  onSelectEvent: (ev: CalendarEvent) => void;
  /**
   * Nur die Tafel selbst (Startseite): ohne Wochenstreifen und LED-Widgets; das Datum
   * im Kopf führt zur vollen Tafel im Kalender.
   */
  compact?: boolean;
}

interface Line {
  /** Identität der Linie: Projekt, sonst Quellkalender. */
  key: string;
  letter: string;
  name: string;
}

export function BoardView({ day, events, loading, projects, colorOf, onSelectDay, onSelectEvent, compact = false }: Props) {
  const now = useNow();

  // Zeigt die Tafel „heute", wandert sie um Mitternacht mit, statt auf gestern stehen zu bleiben.
  const todayKey = dayKey(new Date(now));
  const prevToday = useRef(todayKey);
  useEffect(() => {
    if (prevToday.current !== todayKey && day === prevToday.current) onSelectDay(todayKey);
    prevToday.current = todayKey;
  }, [todayKey, day, onSelectDay]);
  const [showDeparted, setShowDeparted] = useState(false);
  const [showAllDay, setShowAllDay] = useState(false);

  const projName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  /** Linie eines Termins: Projekt, sonst Larvis-Kalender, sonst der Quellkalender. */
  const lineOf = (ev: CalendarEvent): Line => {
    const name =
      (ev.project_id && projName.get(ev.project_id)) ||
      (ev.calendar === 'larvis' ? 'Larvis' : ev.calendar_name || 'Kalender');
    const key = ev.project_id ? `p:${ev.project_id}` : `c:${ev.calendar_id}`;
    return { key, letter: name.trim().charAt(0).toUpperCase() || '•', name };
  };

  const today = day === todayKey;
  const board = useMemo(() => {
    const b = buildBoard(events, day, now);
    // Nur heute trennt „jetzt" kommende von abgefahrenen; an anderen Tagen steht der ganze Fahrplan.
    if (today) return b;
    return { ...b, rows: [...b.departed, ...b.rows].sort((x, y) => x.start - y.start), departed: [] };
  }, [events, day, now, today]);
  const weekStart = startOfWeek(parseISO(day), { weekStartsOn: 1 });
  const week = weekKeys(weekStart);
  const busyDays = useMemo(() => {
    const spans = events.map(eventSpan);
    return new Set(week.filter((k) => spans.some((s) => coversDay(s, k))));
  }, [events, week.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Legende: jede Linie, die an diesem Tag fährt, einmal.
  const legend = useMemo(() => {
    const seen = new Map<string, { line: Line; color: string }>();
    for (const ev of [...board.allDay, ...board.rows.map((r) => r.ev), ...board.departed.map((r) => r.ev)]) {
      const line = lineOf(ev);
      if (!seen.has(line.key)) seen.set(line.key, { line, color: colorOf(ev) });
    }
    return [...seen.values()];
  }, [board, colorOf, projName]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextIdx = board.rows.findIndex((r) => r.state === 'upcoming');
  const shiftWeek = (delta: number) => onSelectDay(dayKey(addDays(parseISO(day), delta * 7)));

  const dateLabel = format(parseISO(day), 'EEEE, d. MMMM', { locale: de });

  const section = (
    <section className={clsx('board', compact && 'board--compact')} aria-label="Abfahrtstafel">
      <header className="board__head">
        <div className="board__kicker">◆ Abfahrten</div>
        {compact ? (
          <Link to="/calendar?view=board" className="board__date board__date--link">
            {dateLabel}
          </Link>
        ) : (
          <div className="board__date">{dateLabel}</div>
        )}
        <div className="board__sub">{subline(board, today)}</div>

        {!compact && (
          <div className="board__week">
            <button type="button" className="board__weeknav" aria-label="Vorherige Woche" onClick={() => shiftWeek(-1)}>
              <ChevronLeft size={16} />
            </button>
            {week.map((k) => {
              const d = parseISO(k);
              return (
                <button
                  key={k}
                  type="button"
                  className={clsx('board__wd', k === day && 'board__wd--active', k === todayKey && 'board__wd--today')}
                  onClick={() => onSelectDay(k)}
                >
                  <span className="board__wd-name">{format(d, 'EEEEEE', { locale: de })}</span>
                  <span className="board__wd-num">{format(d, 'd')}</span>
                  <span className={clsx('board__wd-dot', busyDays.has(k) && 'board__wd-dot--on')} />
                </button>
              );
            })}
            <button type="button" className="board__weeknav" aria-label="Nächste Woche" onClick={() => shiftWeek(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {(legend.length > 0 || board.allDay.length > 0) && (
          <div className="board__legend">
            {legend.map(({ line, color }) => (
              <span key={line.key} className="board-badge" style={{ ['--line' as string]: color }} title={line.name}>
                {line.letter}
              </span>
            ))}
            {board.allDay.length > 0 && (
              <button type="button" className="board__allday-pill" onClick={() => setShowAllDay((v) => !v)}>
                ◆ {board.allDay.length} ganztägig
              </button>
            )}
          </div>
        )}
        <div className="board__cols">
          <span>Abfahrt</span>
          <span>{today ? 'Zeit' : 'Uhr'}</span>
        </div>
      </header>

      {showAllDay && board.allDay.length > 0 && (
        <div className="board__allday">
          {board.allDay.map((ev) => (
            <button key={ev.id} type="button" className="board__allday-row" onClick={() => onSelectEvent(ev)}>
              <span className="board-badge board-badge--sm" style={{ ['--line' as string]: colorOf(ev) }}>
                {lineOf(ev).letter}
              </span>
              {isBirthday(ev) ? '🎂 ' : ''}
              {ev.summary}
            </button>
          ))}
        </div>
      )}

      {board.rows.length === 0 && loading ? (
        <div className="board__empty">Lade Fahrplan …</div>
      ) : board.rows.length === 0 ? (
        <div className="board__empty">
          {today && board.departed.length > 0 ? 'Betriebsschluss — heute fährt nichts mehr.' : 'Keine Abfahrten an diesem Tag.'}
        </div>
      ) : (
        <ol className="board__rows">
          {board.rows.map((r, i) => (
            <DepartureRow
              key={r.ev.id}
              row={r}
              now={now}
              today={today}
              lead={i === 0 && r.state === 'live'}
              next={i === nextIdx && today}
              line={lineOf(r.ev)}
              color={colorOf(r.ev)}
              onSelect={() => onSelectEvent(r.ev)}
            />
          ))}
        </ol>
      )}

      {board.departed.length > 0 && (
        <div className="board__departed">
          <button type="button" className="board__departed-toggle" onClick={() => setShowDeparted((v) => !v)}>
            {showDeparted ? 'Abgefahrene ausblenden' : `${board.departed.length} bereits abgefahren`}
          </button>
          {showDeparted && (
            <ol className="board__rows board__rows--departed">
              {board.departed.map((r) => (
                <DepartureRow
                  key={r.ev.id}
                  row={r}
                  now={now}
                  today={today}
                  lead={false}
                  next={false}
                  line={lineOf(r.ev)}
                  color={colorOf(r.ev)}
                  onSelect={() => onSelectEvent(r.ev)}
                />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );

  if (compact) return section;
  return (
    <div className="board-layout">
      {section}
      <BoardWidgets today={today} board={board} now={now} />
    </div>
  );
}

function subline(board: Board, today: boolean): string {
  const parts: string[] = [];
  if (board.allDay.length > 0) parts.push(`${board.allDay.length} ganztägig`);
  if (today) {
    const live = board.rows.filter((r) => r.state === 'live').length;
    if (live > 0) parts.push(`${live} laufend`);
    parts.push(`${board.rows.length - live} kommend`);
  } else {
    parts.push(`${board.rows.length} ${board.rows.length === 1 ? 'Abfahrt' : 'Abfahrten'}`);
  }
  return parts.join(' · ');
}

interface RowProps {
  row: BoardRow;
  now: number;
  today: boolean;
  lead: boolean;
  next: boolean;
  line: Line;
  color: string;
  onSelect: () => void;
}

function DepartureRow({ row, now, today, lead, next, line, color, onSelect }: RowProps) {
  const { ev, state } = row;
  // Restzeit nur dort, wo „jetzt" zählt: am heutigen Tag bzw. für laufende Termine.
  const showCountdown = state === 'live' || (today && state === 'upcoming');
  const cd = state === 'live' ? countdown(row.until - now) : countdown(row.start - now);

  return (
    <li
      className={clsx('board-row', `board-row--${state}`, lead && 'board-row--lead')}
      style={{ ['--line' as string]: color }}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="board-badge" title={line.name}>
        {line.letter}
      </span>
      <span className="board-row__main">
        {state === 'live' && <span className="board-tag board-tag--live">Live</span>}
        {next && <span className="board-tag">Nächste</span>}
        <span className="board-row__title">{ev.summary}</span>
        {ev.location && <span className="board-row__loc">{ev.location}</span>}
        <span className="board-row__time">
          {format(row.start, 'HH:mm')}–{format(row.end, 'HH:mm')}
        </span>
      </span>
      <span className="board-row__when">
        {showCountdown ? (
          <>
            <span className="board-row__num">{cd.value}</span>
            <span className="board-row__unit">{state === 'live' ? `${cd.unit} übrig` : cd.unit}</span>
          </>
        ) : (
          <>
            <span className="board-row__num">{format(row.start, 'HH:mm')}</span>
            <span className="board-row__unit">{state === 'departed' ? 'weg' : 'Uhr'}</span>
          </>
        )}
      </span>
      {state === 'live' && (
        <span className="board-row__progress" style={{ ['--p' as string]: Math.min(1, row.progress) }} />
      )}
    </li>
  );
}
