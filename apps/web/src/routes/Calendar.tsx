import { useCallback, useMemo, useState } from 'react';
import { addDays, addMonths, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertCircle, ArrowLeft, Cake, CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Layers, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { projectColorMap, type CalendarEvent } from '@larvis/shared';
import { fetchEvents } from '../lib/calendar';
import { useGoogleConnect } from '../features/calendar/useGoogleConnect';
import { listProjects } from '../lib/api';
import { useCachedQuery } from '../lib/cache';
import { useMediaQuery } from '../lib/useMediaQuery';
import { MQ } from '../theme/breakpoints';
import { Button, Card, IconButton, Segmented } from '../components/ui';
import { MonthGrid } from '../features/calendar/MonthGrid';
import { MobileMonth } from '../features/calendar/MobileMonth';
import { AgendaView } from '../features/calendar/AgendaView';
import { DayView } from '../features/calendar/DayView';
import { BirthdaysView } from '../features/calendar/BirthdaysView';
import { BoardView } from '../features/calendar/BoardView';
import { EventEditorModal } from '../features/calendar/EventEditorModal';
import { BirthdayEditorModal } from '../features/calendar/BirthdayEditorModal';
import { eventColorOf } from '../features/calendar/eventColor';
import { CalendarSources } from '../features/calendar/CalendarSources';
import '../features/calendar/calendar.css';

type View = 'month' | 'agenda' | 'board' | 'birthdays';
const VIEWS: readonly View[] = ['month', 'agenda', 'board', 'birthdays'];
const isView = (v: string | null): v is View => VIEWS.includes(v as View);
const DAY = 86_400_000;

function rangeParams(view: View, cursor: Date): { back: number; days: number } {
  const now = Date.now();
  let start: Date;
  let end: Date;
  if (view === 'month') {
    start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
  } else if (view === 'board') {
    // Tafel: die ganze Woche des gewählten Tages, damit der Tageswechsel im Wochenstreifen
    // ohne Nachladen geht und die Punkte für belegte Tage stimmen.
    start = startOfWeek(cursor, { weekStartsOn: 1 });
    end = endOfWeek(cursor, { weekStartsOn: 1 });
  } else if (view === 'birthdays') {
    // Geburtstage: ein volles Jahr voraus, damit jede jährliche Serie einmal vorkommt.
    start = new Date(now);
    end = new Date(now + 365 * DAY);
  } else {
    // Agenda: today onward (a 1-day back margin keeps all of today visible; the
    // AgendaView filters out anything before today).
    start = new Date(now - 1 * DAY);
    end = new Date(now + 45 * DAY);
  }
  return {
    back: Math.max(0, Math.ceil((now - start.getTime()) / DAY)),
    days: Math.max(1, Math.ceil((end.getTime() - now) / DAY)),
  };
}

export function Calendar() {
  const connectGoogle = useGoogleConnect();
  const isMobile = useMediaQuery(MQ.phone);
  // Agenda ist die Standard-Ansicht (Was steht als Nächstes an); Monat auf Klick.
  // `?view=` wählt die Startansicht, etwa die Tafel aus dem Link auf der Startseite.
  const [params] = useSearchParams();
  const [view, setView] = useState<View>(() => {
    const v = params.get('view');
    return isView(v) ? v : 'agenda';
  });
  const [cursor, setCursor] = useState(() => new Date());
  // Geöffneter Tag der Monatsansicht (YYYY-MM-DD); null zeigt das Raster.
  const [day, setDay] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [defaultDate, setDefaultDate] = useState<string | undefined>(undefined);

  const [bdayOpen, setBdayOpen] = useState(false);
  const [editingBday, setEditingBday] = useState<CalendarEvent | null>(null);
  const [bdayDefaultDate, setBdayDefaultDate] = useState<string | undefined>(undefined);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const cursorTime = cursor.getTime();

  // Cache-Key pro Ansicht/Monat: gecachte Termine erscheinen sofort, frische
  // Daten laufen im Hintergrund nach.
  const cacheKey =
    view === 'month'
      ? `cal:month:${format(cursor, 'yyyy-MM')}`
      : view === 'board'
        ? `cal:board:${format(startOfWeek(cursor, { weekStartsOn: 1 }), 'yyyy-MM-dd')}`
        : view === 'birthdays'
          ? 'cal:birthdays:365'
          : 'cal:agenda:45';
  const fetcher = useCallback(() => {
    const { back, days } = rangeParams(view, new Date(cursorTime));
    return fetchEvents({ days, back });
  }, [view, cursorTime]);
  const { data, loading, refetch: load } = useCachedQuery(cacheKey, fetcher);
  const { data: projects } = useCachedQuery('projects', listProjects);
  const events = data?.events ?? [];
  // Google verbunden; Kalender-Abos zeigen ihre Termine auch ohne Google.
  const connected = data?.connected ?? true;
  const hasSubscriptions = (data?.subscriptions ?? 0) > 0;
  const loadErrors = data?.errors ?? [];

  const projColor = useMemo(() => projectColorMap(projects ?? []), [projects]);
  const colorOf = useCallback((ev: CalendarEvent) => eventColorOf(ev, projColor), [projColor]);

  function openNew(dateStr?: string) {
    // Ohne Google gibt es keinen Kalender, in den ein neuer Termin gehen könnte.
    if (!connected) return;
    setEditing(null);
    setDefaultDate(dateStr);
    setEditorOpen(true);
  }
  function openNewBirthday() {
    setEditingBday(null);
    setBdayDefaultDate(undefined);
    setBdayOpen(true);
  }
  /** Tag öffnen oder wechseln; der Monat folgt, damit dessen Termine geladen sind. */
  function openDay(dateStr: string) {
    setDay(dateStr);
    setCursor(parseISO(dateStr));
  }
  function openEvent(ev: CalendarEvent) {
    // Birthdays get their own slim editor; regular events use the full one.
    if (ev.event_type === 'birthday') {
      setEditingBday(ev);
      setBdayDefaultDate(undefined);
      setBdayOpen(true);
      return;
    }
    setEditing(ev);
    setDefaultDate(undefined);
    setEditorOpen(true);
  }

  const sources = sourcesOpen && (
    <CalendarSources open onClose={() => setSourcesOpen(false)} googleConnected={connected} onChanged={load} />
  );

  if (!connected && !hasSubscriptions && !loading) {
    return (
      <div className="page">
        <div className="page__header">
          <h1 className="page__title">Kalender</h1>
        </div>
        <Card>
          <div className="stack gap-sm center" style={{ padding: '12px 0' }}>
            <CalendarDays size={28} className="text-muted" />
            <span className="text-muted" style={{ fontSize: 14, textAlign: 'center' }}>
              Verbinde deinen Google-Kalender, um Termine zu sehen und anzulegen, oder abonniere einen
              Kalender über seinen ICS-Link (Outlook, Arbeitskonto).
            </span>
            <div className="row gap-sm" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <Button onClick={connectGoogle}>
                <ExternalLink size={15} /> Kalender verbinden
              </Button>
              <Button variant="ghost" onClick={() => setSourcesOpen(true)}>
                <Layers size={15} /> Kalender-Abo
              </Button>
            </div>
          </div>
        </Card>
        {sources}
      </div>
    );
  }

  const monthLabel = format(cursor, 'LLLL yyyy', { locale: de });
  const openedDay = view === 'month' ? day : null;

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Kalender</h1>
        <div className="row gap-sm center">
          <IconButton label="Kalender und Abos" onClick={() => setSourcesOpen(true)}>
            <Layers size={18} />
          </IconButton>
          {/* Anlegen geht nur in Google; Abos sind schreibgeschützt. */}
          {connected && (
            <>
              <Button variant="ghost" onClick={openNewBirthday}>
                <Cake size={16} /> Geburtstag
              </Button>
              <Button variant="primary" onClick={() => openNew()}>
                <Plus size={16} /> Termin
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="cal-toolbar">
        <Segmented<View>
          value={view}
          onChange={(v) => {
            setView(v);
            setDay(null);
            // Die Tafel startet immer bei heute.
            if (v === 'board') setCursor(new Date());
          }}
          options={[
            { value: 'month', label: 'Monat' },
            { value: 'agenda', label: 'Agenda' },
            { value: 'board', label: 'Tafel' },
            { value: 'birthdays', label: 'Geburtstage' },
          ]}
        />
        {openedDay && (
          <div className="cal-daynav">
            <Button size="sm" variant="ghost" onClick={() => setDay(null)}>
              <ArrowLeft size={15} /> Monat
            </Button>
            <div className="row gap-sm center" style={{ marginLeft: 'auto' }}>
              <IconButton size="sm" label="Vorheriger Tag" onClick={() => openDay(format(addDays(parseISO(openedDay), -1), 'yyyy-MM-dd'))}>
                <ChevronLeft size={18} />
              </IconButton>
              <span className="cal-month-label cal-month-label--day">
                {format(parseISO(openedDay), 'EEEE, d. MMMM', { locale: de })}
              </span>
              <IconButton size="sm" label="Nächster Tag" onClick={() => openDay(format(addDays(parseISO(openedDay), 1), 'yyyy-MM-dd'))}>
                <ChevronRight size={18} />
              </IconButton>
              {connected && (
                <Button size="sm" variant="ghost" onClick={() => openNew(openedDay)}>
                  <Plus size={15} /> Termin
                </Button>
              )}
            </div>
          </div>
        )}
        {view === 'month' && !openedDay && (
          <div className="row gap-sm center" style={{ marginLeft: 'auto' }}>
            <IconButton size="sm" label="Vorheriger Monat" onClick={() => setCursor((c) => addMonths(c, -1))}>
              <ChevronLeft size={18} />
            </IconButton>
            <span className="cal-month-label" style={{ textAlign: 'center' }}>{monthLabel}</span>
            <IconButton size="sm" label="Nächster Monat" onClick={() => setCursor((c) => addMonths(c, 1))}>
              <ChevronRight size={18} />
            </IconButton>
            <Button size="sm" variant="ghost" onClick={() => setCursor(new Date())}>Heute</Button>
          </div>
        )}
      </div>

      {loadErrors.length > 0 && (
        <div className="cal-load-errors" role="status">
          <AlertCircle size={14} />
          <span>
            Nicht geladen: {loadErrors.map((e) => `${e.calendar} (${e.error})`).join(' · ')}
          </span>
        </div>
      )}

      {openedDay ? (
        <DayView day={openedDay} events={events} colorOf={colorOf} onSelectEvent={openEvent} onCreateAt={openNew} />
      ) : view === 'board' ? (
        <BoardView
          day={format(cursor, 'yyyy-MM-dd')}
          events={events}
          loading={loading}
          projects={projects ?? []}
          colorOf={colorOf}
          onSelectDay={(d) => setCursor(parseISO(d))}
          onSelectEvent={openEvent}
        />
      ) : view === 'birthdays' ? (
        <BirthdaysView events={events} onSelectEvent={openEvent} />
      ) : view === 'month' ? (
        isMobile ? (
          <MobileMonth
            cursor={cursor}
            events={events}
            colorOf={colorOf}
            onSelectEvent={openEvent}
            onCreateAt={openNew}
            onOpenDay={openDay}
            onSwipeMonth={(delta) => setCursor((c) => addMonths(c, delta))}
          />
        ) : (
          <MonthGrid cursor={cursor} events={events} colorOf={colorOf} onSelectDay={openDay} />
        )
      ) : (
        <AgendaView events={events} colorOf={colorOf} onSelectEvent={openEvent} />
      )}

      {/* Mount only while open so the editor's fields reset for each event
          (its state is seeded from props on mount). */}
      {editorOpen && (
        <EventEditorModal
          event={editing}
          open
          onClose={() => setEditorOpen(false)}
          onSaved={load}
          projects={projects ?? []}
          defaultDate={defaultDate}
        />
      )}

      {sources}

      {bdayOpen && (
        <BirthdayEditorModal
          event={editingBday}
          open
          onClose={() => setBdayOpen(false)}
          onSaved={load}
          defaultDate={bdayDefaultDate}
        />
      )}
    </div>
  );
}
