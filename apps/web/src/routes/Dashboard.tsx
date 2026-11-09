import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bus, Droplets, LayoutGrid, UtensilsCrossed } from 'lucide-react';
import { format, isPast, isToday, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { clsx } from 'clsx';
import type { Todo } from '@larvis/shared';
import { listTodos } from '../lib/api';
import { formatDue, priorityColor } from '../lib/format';
import { useLiveQuery } from '../lib/useLive';
import { useCachedQuery } from '../lib/cache';
import { fetchLocalWeather } from '../lib/weather';
import { CANTEENS, MODULES, WEATHER_LOCATION } from '../lib/modules';
import { BUS_STOP_NAME, type OccupancyLevel } from '../lib/transit';
import { useBusDepartures } from '../lib/useBusDepartures';
import { fetchDays, fetchMeals, formatPrice, mainMeals, pickDay, type Diet, type Meal } from '../lib/mensa';
import { codeInfo } from '../features/weather/WeatherCard';
import { IconButton } from '../components/ui';
import { Logo } from '../components/Logo';
import './dashboard.css';

// Kiosk-Dashboard für einen fest montierten Bildschirm: ein statisches Bento-Grid, das
// exakt in den Screen passt (kein Scrollen, keine Interaktion nötig). Daten halten
// sich selbst frisch: Todos via Realtime, Bus alle 20 s, Wetter alle 15 min,
// Mensa rotiert durch bis zu drei Mensen und lädt pro Tag einmal. Wetter, Mensa und Bus
// erscheinen nur, wenn ihr Modul konfiguriert ist; fehlen welche, rückt der Rest zusammen.

const BUS_REFRESH_MS = 20_000;
const WEATHER_REFRESH_MS = 15 * 60_000;
const MENSA_ROTATE_MS = 12_000;
const TV_CANTEEN_IDS = CANTEENS.slice(0, 3).map((c) => c.id);

function useClock(intervalMs = 15_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Der TV läuft wochenlang durch: einmal pro Nacht neu laden, damit der
// Service Worker frische Deploys übernimmt. Uptime-Guard gegen Reload-Loops.
function useNightlyReload(now: Date) {
  useEffect(() => {
    if (now.getHours() === 4 && now.getMinutes() < 2 && performance.now() > 10 * 60_000) {
      window.location.reload();
    }
  }, [now]);
}

// ---- KPIs ----------------------------------------------------------------

function computeKpis(todos: Todo[]) {
  let open = 0, doing = 0, dueToday = 0, overdue = 0;
  for (const t of todos) {
    open++;
    if (t.status === 'doing') doing++;
    if (t.due_at) {
      const d = parseISO(t.due_at);
      if (isToday(d)) dueToday++;
      else if (isPast(d)) overdue++;
    }
  }
  return { open, doing, dueToday, overdue };
}

function Kpi({ num, label, tone }: { num: number; label: string; tone?: 'accent' | 'danger' }) {
  return (
    <div className="tv-kpi">
      <div className={clsx('tv-kpi__num', tone === 'accent' && 'text-accent')} style={tone === 'danger' ? { color: 'var(--danger)' } : undefined}>
        {num}
      </div>
      <div className="tv-kpi__label">{label}</div>
    </div>
  );
}

// Read-only-Zeile für die wichtigsten offenen ToDos (Server sortiert bereits
// nach Priorität, dann Fälligkeit).
function TvTodo({ todo }: { todo: Todo }) {
  const due = formatDue(todo.due_at);
  return (
    <div className="tv-todo">
      <span className="tv-todo__prio" style={{ background: todo.priority > 0 ? priorityColor(todo.priority) : 'var(--text-faint)' }} />
      <span className="tv-todo__title">{todo.title}</span>
      {due && (
        <span className="tv-todo__due" style={due.overdue ? { color: 'var(--danger)' } : undefined}>
          {due.label}
        </span>
      )}
    </div>
  );
}

// ---- Wetter ----------------------------------------------------------------

function TvWeather() {
  const { data, refetch } = useCachedQuery('weather', fetchLocalWeather);
  useEffect(() => {
    const id = setInterval(() => void refetch(), WEATHER_REFRESH_MS);
    return () => clearInterval(id);
  }, [refetch]);

  if (!data) return <div className="tv-empty">Wetter lädt …</div>;
  const now = codeInfo(data.now.code);
  const today = data.daily[0];
  const tomorrow = data.daily[1];
  const TomorrowIcon = tomorrow ? codeInfo(tomorrow.code).Icon : null;
  const week = data.daily.slice(2, 7);

  return (
    <>
      <div className="tv-wx__main">
        <div className="tv-wx__now">
          <now.Icon className="tv-wx__icon" strokeWidth={1.5} />
          <div>
            <div className="tv-wx__temp">{data.now.temp}°</div>
            <div className="tv-wx__cond">{now.label} · gefühlt {data.now.feelsLike}°</div>
            <div className="tv-wx__range">
              <span className="text-accent">{today?.tMax}°</span> / {today?.tMin}°
              {today?.precipProb != null && today.precipProb >= 10 && (
                <span className="tv-wx__precip"><Droplets size={14} /> {today.precipProb}%</span>
              )}
            </div>
          </div>
        </div>
        {tomorrow && TomorrowIcon && (
          <div className="tv-wx__tomorrow">
            <div className="tv-wx__label">Morgen</div>
            <TomorrowIcon className="tv-wx__icon-sm" strokeWidth={1.5} />
            <div className="tv-wx__range">
              <span className="text-accent">{tomorrow.tMax}°</span> / {tomorrow.tMin}°
            </div>
          </div>
        )}
      </div>
      <div className="tv-wx__week">
        {week.map((d) => {
          const info = codeInfo(d.code);
          return (
            <div key={d.date} className="tv-wx__day">
              <div className="tv-wx__label">{format(parseISO(d.date), 'EEEEEE', { locale: de })}</div>
              <info.Icon size={22} strokeWidth={1.6} className="text-muted" />
              <div className="tv-wx__day-max">{d.tMax}°</div>
              <div className="tv-wx__day-min">{d.tMin}°</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---- Abfahrten -------------------------------------------------------------

const OCC_CLASS: Record<OccupancyLevel, string> = {
  0: 'occ--unknown', 1: 'occ--low', 2: 'occ--mid', 3: 'occ--high', 4: 'occ--full',
};

function TvBus() {
  const { deps, error } = useBusDepartures(BUS_REFRESH_MS);

  if (error && deps == null) return <div className="tv-empty">Abfahrten nicht erreichbar.</div>;
  if (deps == null) return <div className="tv-empty">Abfahrten laden …</div>;
  if (deps.length === 0) return <div className="tv-empty">Keine Abfahrten in der nächsten Stunde.</div>;

  return (
    <div className="tv-bus__list">
      {deps.slice(0, 8).map((d) => (
        <div key={d.id} className="tv-bus__row">
          <span className={clsx('bus-line', d.line.startsWith('N') && 'bus-line--night')}>{d.line}</span>
          <div className="tv-bus__main">
            <div className="tv-bus__dest">{d.destination}</div>
            <div className="tv-bus__meta">
              <span className={clsx('occ', OCC_CLASS[d.occupancy])}>
                <span className="occ__dot" /> {d.occupancyLabel}
              </span>
              {d.hbfMinutes != null && d.hbfArrivalAt != null && (
                <span className="tv-bus__hbf">Hbf {format(d.hbfArrivalAt, 'HH:mm')}</span>
              )}
            </div>
          </div>
          <div className="tv-bus__when">
            <span className="tv-bus__min">{d.minutesUntil <= 0 ? 'jetzt' : `${d.minutesUntil} min`}</span>
            <span className="tv-bus__time">
              {format(d.expectedAt, 'HH:mm')}
              {d.delayMin > 0 && <span className="tv-bus__delay"> +{d.delayMin}</span>}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Mensa (rotierend) ------------------------------------------------------

const DIET_COLOR: Record<NonNullable<Diet>, string> = {
  vegan: 'var(--success)',
  vegetarisch: 'var(--success)',
  fisch: '#3A82F6',
  fleisch: 'var(--warning)',
};

function TvMensaPane({ canteenId, todayISO, active }: { canteenId: number; todayISO: string; active: boolean }) {
  const name = CANTEENS.find((c) => c.id === canteenId)?.name ?? String(canteenId);
  const { data: days } = useCachedQuery(`mensa:days:${canteenId}`, () => fetchDays(canteenId));
  const date = days ? pickDay(days, todayISO) : null;
  const { data: meals } = useCachedQuery(
    `mensa:meals:${canteenId}:${date ?? 'none'}`,
    () => (date ? fetchMeals(canteenId, date) : Promise.resolve<Meal[]>([])),
  );
  // Einträge ohne Preis sind Info-Texte der Mensa ("Frisch zubereitet …"),
  // keine Gerichte.
  const mains = mainMeals(meals ?? [])
    .filter((m) => m.priceStudent != null || m.priceEmployee != null)
    .slice(0, 4);
  const isTodayPlan = date === todayISO;

  return (
    <div className={clsx('tv-rotate__pane', active && 'tv-rotate__pane--active')} aria-hidden={!active}>
      <div className="tv-mensa__head">
        <span className="tv-mensa__name">{name}</span>
        {date && !isTodayPlan && (
          <span className="tv-mensa__daybadge">{format(parseISO(date), 'EEEE', { locale: de })}</span>
        )}
      </div>
      {!days || (date && !meals) ? (
        <div className="tv-empty">Speiseplan lädt …</div>
      ) : !date || mains.length === 0 ? (
        <div className="tv-empty">Kein Speiseplan — geschlossen.</div>
      ) : (
        <div className="tv-mensa__list">
          {mains.map((m) => (
            <div key={m.id} className="tv-mensa__meal">
              <span className="tv-mensa__diet" style={{ background: m.diet ? DIET_COLOR[m.diet] : 'var(--text-faint)' }} />
              <span className="tv-mensa__mealname">{m.name}</span>
              {formatPrice(m.priceStudent) && <span className="tv-mensa__price">{formatPrice(m.priceStudent)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TvMensa({ todayISO }: { todayISO: string }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % TV_CANTEEN_IDS.length), MENSA_ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {/* Alle drei Panes bleiben gemountet (Daten vorgeladen), nur eins ist sichtbar. */}
      <div className="tv-rotate">
        {TV_CANTEEN_IDS.map((id, i) => (
          <TvMensaPane key={id} canteenId={id} todayISO={todayISO} active={i === idx} />
        ))}
      </div>
      <div className="tv-rotate__dots">
        {TV_CANTEEN_IDS.map((id, i) => (
          <span key={id} className={clsx('tv-rotate__dot', i === idx && 'tv-rotate__dot--active')} />
        ))}
      </div>
    </>
  );
}

// ---- Dashboard --------------------------------------------------------------

export function Dashboard() {
  const now = useClock();
  useNightlyReload(now);
  const todayISO = format(now, 'yyyy-MM-dd');
  // Gleicher Filter + Cache-Key wie die ToDo-Hauptliste (ohne Backlog).
  const { data: todos } = useLiveQuery(
    () => listTodos({ includeDone: false, backlog: false }),
    ['todos'],
    [],
    'todos:{"includeDone":false,"backlog":false}',
  );
  const k = computeKpis(todos ?? []);
  const topTodos = (todos ?? []).slice(0, 5);
  const sides = [MODULES.weather, MODULES.mensa, MODULES.bus].filter(Boolean).length;

  return (
    <div className={clsx('dash', sides < 3 && `dash--flow dash--sides-${sides}`)}>
      {/* Uhr + Datum */}
      <section className="tv-card tv-cell--clock">
        <div className="dash__clock">{format(now, 'HH:mm')}</div>
        <div className="dash__date">{format(now, 'EEEE, d. MMMM', { locale: de })}</div>
        <div className="tv-brand">
          <Logo />
          <Link to="/" style={{ marginLeft: 'auto' }}>
            <IconButton size="sm" label="Zur App">
              <LayoutGrid size={16} />
            </IconButton>
          </Link>
        </div>
      </section>

      {/* KPIs + wichtigste ToDos */}
      <section className="tv-card tv-cell--kpis">
        <div className="tv-kpi-row">
          <Kpi num={k.open} label="Offen" />
          <Kpi num={k.doing} label="In Arbeit" />
          <Kpi num={k.dueToday} label="Fällig" tone="accent" />
          <Kpi num={k.overdue} label="Überfällig" tone={k.overdue > 0 ? 'danger' : undefined} />
        </div>
        <div className="tv-card__title" style={{ margin: 'clamp(10px, 1.2vw, 18px) 0 clamp(4px, 0.6vw, 10px)' }}>
          Wichtigste ToDos
        </div>
        <div className="tv-todos">
          {topTodos.map((t) => <TvTodo key={t.id} todo={t} />)}
          {todos && todos.length === 0 && <div className="tv-empty">Nichts offen. Genieß den Tag.</div>}
        </div>
      </section>

      {/* Wetter */}
      {MODULES.weather && (
        <section className="tv-card tv-cell--weather">
          <div className="tv-card__title">Wetter · {WEATHER_LOCATION?.name}</div>
          <TvWeather />
        </section>
      )}

      {/* Mensa, rotierend */}
      {MODULES.mensa && (
        <section className="tv-card tv-cell--mensa">
          <div className="tv-card__title">
            <UtensilsCrossed size={18} className="text-accent" /> Mensa heute
          </div>
          <TvMensa todayISO={todayISO} />
        </section>
      )}

      {/* Abfahrten */}
      {MODULES.bus && (
        <section className="tv-card tv-cell--bus">
          <div className="tv-card__title">
            <Bus size={18} className="text-accent" /> {BUS_STOP_NAME}
          </div>
          <TvBus />
        </section>
      )}
    </div>
  );
}
