import { useCallback, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { projectColorMap, type CalendarEvent } from '@larvis/shared';
import { fetchEvents } from '../../lib/calendar';
import { useGoogleConnect } from './useGoogleConnect';
import { listProjects } from '../../lib/api';
import { useCachedQuery } from '../../lib/cache';
import { Button } from '../../components/ui';
import { BoardView } from './BoardView';
import { EventEditorModal } from './EventEditorModal';
import { eventColorOf } from './eventColor';
import { dayKey } from './layout';
import { todayWindow } from './todayWindow';
import './calendar.css';

// Die Abfahrtstafel auf Heute: nur der heutige Tag, ohne Wochenstreifen und Widgets.
// Der Tag wandert um Mitternacht mit (BoardView meldet den neuen Tag über onSelectDay),
// dann lädt der neue Cache-Schlüssel die Termine des neuen Tages.
export function HomeBoard() {
  const connectGoogle = useGoogleConnect();
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [open, setOpen] = useState(false);

  const fetcher = useCallback(() => fetchEvents(todayWindow(new Date())), []);
  const { data, loading, refetch: load } = useCachedQuery(`cal:home:${day}`, fetcher);
  const { data: projects } = useCachedQuery('projects', listProjects);
  const events = data?.events ?? [];
  // Kalender-Abos zeigen ihre Termine auch ohne Google-Verbindung.
  const connected = (data?.connected ?? true) || (data?.subscriptions ?? 0) > 0;

  const projColor = useMemo(() => projectColorMap(projects ?? []), [projects]);
  const colorOf = useCallback((ev: CalendarEvent) => eventColorOf(ev, projColor), [projColor]);

  return (
    <section className="home-board">
      <div className="section-title">Heute</div>

      {!connected && !loading ? (
        <div className="group">
          <div className="group__empty stack gap-sm center">
            <span>Google Calendar noch nicht verbunden.</span>
            <Button size="sm" onClick={connectGoogle}>
              <ExternalLink size={15} /> Kalender verbinden
            </Button>
          </div>
        </div>
      ) : (
        <BoardView
          compact
          day={day}
          events={events}
          loading={loading}
          projects={projects ?? []}
          colorOf={colorOf}
          onSelectDay={setDay}
          onSelectEvent={(ev) => {
            setEditing(ev);
            setOpen(true);
          }}
        />
      )}

      {/* Nur offen gemountet, damit der Editor seine Felder aus dem gewählten Termin neu füllt. */}
      {open && (
        <EventEditorModal
          event={editing}
          open
          onClose={() => setOpen(false)}
          onSaved={load}
          projects={projects ?? []}
        />
      )}
    </section>
  );
}
