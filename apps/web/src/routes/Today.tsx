import { isPast, isToday, parseISO } from 'date-fns';
import type { Todo } from '@larvis/shared';
import { listTodos } from '../lib/api';
import { useLiveQuery } from '../lib/useLive';
import { useMediaQuery } from '../lib/useMediaQuery';
import { MQ } from '../theme/breakpoints';
import { TodoList } from '../features/todos/TodoList';
import { HomeBoard } from '../features/calendar/HomeBoard';
import { HOME_TODO_CAP } from '../features/todos/cap';
import { DumpCard } from '../features/inbox/DumpCard';
import { BriefingCard } from '../features/briefing/BriefingCard';
import { WeatherCard } from '../features/weather/WeatherCard';
import { BusCard } from '../features/transit/BusCard';
import { MensaCard } from '../features/mensa/MensaCard';
import { MODULES } from '../lib/modules';
import { PomodoroCard } from '../features/pomodoro/PomodoroCard';
import './today.css';

function computeStats(todos: Todo[]) {
  let open = 0, doing = 0, done = 0, dueToday = 0, overdue = 0;
  // Dieselbe Menge wie die Liste „Heute & überfällig": offen, nicht im Backlog, fällig bis heute.
  let listDueToday = 0, listOverdue = 0;
  for (const t of todos) {
    if (t.status === 'done') {
      done++;
      continue;
    }
    open++;
    if (t.status === 'doing') doing++;
    if (t.due_at) {
      const d = parseISO(t.due_at);
      const today = isToday(d);
      const past = !today && isPast(d);
      if (today) dueToday++;
      else if (past) overdue++;
      if (!t.backlog) {
        if (today) listDueToday++;
        else if (past) listOverdue++;
      }
    }
  }
  return { open, doing, done, dueToday, overdue, list: { total: listDueToday + listOverdue, overdue: listOverdue } };
}

function Stat({ num, label, tone }: { num: number; label: string; tone?: 'accent' | 'danger' }) {
  return (
    <div className="stat">
      <div
        className="stat__num"
        style={{ color: tone === 'danger' ? 'var(--danger)' : tone === 'accent' ? 'var(--accent)' : undefined }}
      >
        {num}
      </div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

// Heute folgt der Abstandsregel „höchstens eine Rahmenebene": Listen sind
// Gruppen direkt auf der Seite (Titel außen), Widgets eigene Karten, nichts
// steckt in einer zweiten Karte. Pomodoro bleibt außerhalb von .home, damit nie ein
// Container die Vollbild-Ansicht (position: fixed) einsperrt.
export function Today() {
  const isMobile = !useMediaQuery(MQ.desktop);
  const { data: allTodos } = useLiveQuery(() => listTodos({ includeDone: true }), ['todos'], [], 'todos:all');

  const s = computeStats(allTodos ?? []);

  const todos = (
    <section>
      <div className="section-title today-todos__title">
        Heute & überfällig
        {s.list.total > 0 && <span className="today-todos__count">{s.list.total}</span>}
        {s.list.overdue > 0 && <span className="today-todos__overdue">{s.list.overdue} überfällig</span>}
      </div>
      {/* Alles, was heute fällig oder überfällig ist (per Sonne markierte ToDos tragen
          das heutige Datum). Neue ToDos von hier landen direkt auf der Heute-Liste. */}
      <TodoList
        filter={{ forToday: true, includeDone: false, backlog: false }}
        defaults={{ today: true }}
        limit={HOME_TODO_CAP}
        scroll
        moreHref="/todos"
        emptyText="Nichts für heute geplant. Auf der ToDos-Seite mit der Sonne markieren."
      />
    </section>
  );

  // Wetter | Bus | Mensa, jeweils nur bei konfiguriertem Modul (lib/modules.ts);
  // .home-left ist der Container, nach dessen Breite sich das Widget-Raster richtet.
  const hasWidgets = MODULES.weather || MODULES.bus || MODULES.mensa;
  const widgets = hasWidgets ? (
    <div className="home-widgets">
      {MODULES.weather && <WeatherCard />}
      {MODULES.bus && <BusCard />}
      {MODULES.mensa && <MensaCard />}
    </div>
  ) : null;

  return (
    <div className="page page--wide">
      <div className="page__header">
        <h1 className="page__title">Heute</h1>
      </div>

      {isMobile ? (
        // Handy/Tablet: was jetzt ansteht zuerst (Abfahrtstafel des Tages), dann ToDos,
        // Dump, Widgets, Pomodoro, Briefing zuletzt.
        <div className="stack-section">
          <HomeBoard />
          {todos}
          <DumpCard />
          {widgets && <div className="home-left">{widgets}</div>}
          <PomodoroCard />
          <BriefingCard />
        </div>
      ) : (
        <div className="stack-section">
          {/* KPI-Leiste: eine Gruppe, Zellen durch senkrechte Hairlines getrennt. */}
          <div className="group today-stats">
            <Stat num={s.open} label="Offen" />
            <Stat num={s.doing} label="In Arbeit" />
            <Stat num={s.dueToday} label="Heute fällig" tone="accent" />
            <Stat num={s.overdue} label="Überfällig" tone={s.overdue > 0 ? 'danger' : undefined} />
            <Stat num={s.done} label="Erledigt" />
          </div>

          <div className="home">
            <div className="home-split">
              <div className="home-left stack-section">
                {todos}
                <DumpCard />
                {widgets}
              </div>
              {/* Rechte Spalte: die Tafel bleibt beim Scrollen stehen. */}
              <div className="today-board">
                <HomeBoard />
              </div>
            </div>
          </div>

          <PomodoroCard />
          <BriefingCard />
        </div>
      )}
    </div>
  );
}
