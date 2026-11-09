import { useState } from 'react';
import { Trash2, ExternalLink, MapPin } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { selectableProjects, type CalendarEvent, type EventInput, type Project } from '@larvis/shared';
import { createEvent, deleteEvent, updateEvent } from '../../lib/calendar';
import { isLeadNotifiable } from '../../lib/notifications';
import { listPlaces } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { matchPlace, placeHint } from '../places/matchPlace';
import { useToast } from '../../lib/toast';
import { Drawer } from '../../components/Drawer';
import { DatePicker, DateTimePicker } from '../../components/DateTimePicker';
import { ReminderField } from '../../components/ReminderField';
import type { ReminderTarget } from '../../lib/reminders';
import { Button, TextArea, TextInput } from '../../components/ui';

interface Props {
  event: CalendarEvent | null; // null = new
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  projects: Project[];
  /** Pre-selected day for a new event (YYYY-MM-DD). */
  defaultDate?: string;
}

const DAY_MS = 86_400_000;
const fetchPlaces = () => listPlaces();
const DEFAULT_DURATION_MS = 3_600_000; // 1 h

// datetime-local <-> ISO helpers (browser-local time).
function toLocalInput(iso: string): string {
  try {
    return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm");
  } catch {
    return '';
  }
}
function localInputToISO(local: string): string {
  return new Date(local).toISOString();
}
function toInput(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}
function parseLocal(v: string): Date | null {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Zeitraum eines Termins für die Leseansicht, z. B. „Mo., 19. Okt., 14:00–14:30“. */
function describeWhen(ev: CalendarEvent): string {
  try {
    if (ev.all_day) {
      const start = parseISO(ev.start);
      const lastDay = new Date(parseISO(ev.end).getTime() - DAY_MS);
      const startLabel = format(start, 'EEE, d. MMM', { locale: de });
      return lastDay > start ? `${startLabel} – ${format(lastDay, 'EEE, d. MMM', { locale: de })}, ganztägig` : `${startLabel}, ganztägig`;
    }
    const start = parseISO(ev.start);
    const end = parseISO(ev.end);
    const sameDay = format(start, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd');
    return sameDay
      ? `${format(start, 'EEE, d. MMM, HH:mm', { locale: de })}–${format(end, 'HH:mm')}`
      : `${format(start, 'EEE, d. MMM, HH:mm', { locale: de })} – ${format(end, 'EEE, d. MMM, HH:mm', { locale: de })}`;
  } catch {
    return '';
  }
}

/** Start für einen neuen Termin: heute → nächste volle Stunde, sonst 09:00. */
function defaultStart(baseDate: string): string {
  if (baseDate !== format(new Date(), 'yyyy-MM-dd')) return `${baseDate}T09:00`;
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toInput(d);
}

export function EventEditorModal({ event, open, onClose, onSaved, projects, defaultDate }: Props) {
  const { saved, notify } = useToast();
  const baseDate = defaultDate ?? (event ? event.start.slice(0, 10) : format(new Date(), 'yyyy-MM-dd'));

  const [summary, setSummary] = useState(event?.summary ?? '');
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [date, setDate] = useState(event && event.all_day ? event.start.slice(0, 10) : baseDate);
  const initialStart = event && !event.all_day ? toLocalInput(event.start) : defaultStart(baseDate);
  const [startDT, setStartDT] = useState(initialStart);
  const [endDT, setEndDT] = useState(
    event && !event.all_day
      ? toLocalInput(event.end)
      : toInput(new Date((parseLocal(initialStart) ?? new Date()).getTime() + DEFAULT_DURATION_MS)),
  );
  const [location, setLocation] = useState(event?.location ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [projectId, setProjectId] = useState<string | null>(event?.project_id ?? null);
  const [tags, setTags] = useState((event?.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const { data: places } = useLiveQuery(fetchPlaces, ['places'], [], 'places');

  // Beginn und Ende bleiben gekoppelt: Beginn verschieben nimmt das Ende mit
  // (die eingestellte Dauer bleibt erhalten); ein Ende vor dem Beginn zieht
  // den Beginn entsprechend zurück. So entsteht nie ein negativer Zeitraum.
  function currentDuration(): number {
    const s = parseLocal(startDT);
    const e = parseLocal(endDT);
    return s && e && e > s ? e.getTime() - s.getTime() : DEFAULT_DURATION_MS;
  }
  function changeStart(v: string) {
    const dur = currentDuration();
    setStartDT(v);
    const next = parseLocal(v);
    if (next) setEndDT(toInput(new Date(next.getTime() + dur)));
  }
  function changeEnd(v: string) {
    const dur = currentDuration();
    setEndDT(v);
    const next = parseLocal(v);
    const start = parseLocal(startDT);
    if (next && start && next <= start) setStartDT(toInput(new Date(next.getTime() - dur)));
  }

  // Read-only only for events on calendars we can't write to (e.g. subscribed
  // holiday calendars). New events and any owner/writer calendar are editable.
  // Termine aus Kalender-Abos (Outlook, Arbeits-Google per ICS-Link) sind immer schreibgeschützt.
  const isSubscription = event?.calendar === 'subscription';
  const readOnly = Boolean(event && (!event.editable || isSubscription));
  // Project/tags are Larvis concepts — only offer them on the app calendar.
  const isLarvis = !event || event.calendar === 'larvis';
  const linkedTodo = Boolean(event?.todo_id);
  const eventProject = event?.project_id ? projects.find((p) => p.id === event.project_id) ?? null : null;

  // Ort: der Freitext wird beim Speichern einem Larvis-Ort zugeordnet (Name oder
  // Alias, exakt). Trägt der Termin schon einen Ort, dessen Name nicht im Text steht
  // (etwa von Claude zugeordnet), bleibt diese Zuordnung, solange der Text unverändert ist.
  const matchedPlace = matchPlace(location, places ?? []);
  const keptPlace =
    !matchedPlace && event?.place_id && location.trim() === (event.location ?? '').trim()
      ? (places ?? []).find((p) => p.id === event.place_id && !p.deleted_at) ?? null
      : null;
  const place = matchedPlace ?? keptPlace;

  // Ziel der Glocke: ein ToDo-Spiegel stellt die Erinnerung seines ToDos ein, jeder andere
  // Termin seine eigene. Die Einstellung liegt nur in Larvis (Tabelle reminders) und
  // berührt den Ursprungskalender nie — deshalb auch für schreibgeschützte Termine und Abos.
  const reminderTarget: ReminderTarget | null = event
    ? event.todo_id
      ? {
          kind: 'todo',
          todoId: event.todo_id,
          title: (summary || event.summary).replace(/^✓\s*/, '').trim() || 'Todo',
          // Ganztägig als Mitternacht UTC — dieselbe Abbildung wie in api/calendar/events.ts.
          start: event.all_day ? `${event.start.slice(0, 10)}T00:00:00.000Z` : new Date(event.start).toISOString(),
        }
      : {
          kind: 'event',
          eventId: event.id,
          calendarId: event.calendar_id,
          title: summary || event.summary,
          start: event.start,
          leadNotifiable: isLeadNotifiable(event),
        }
    : null;

  async function save() {
    if (!summary.trim() || busy) return;
    setBusy(true);
    try {
      const input: EventInput = {
        summary: summary.trim(),
        location: (isLarvis && matchedPlace ? matchedPlace.name : location.trim()) || undefined,
        description: description.trim() || undefined,
        all_day: allDay,
        start: allDay ? date : localInputToISO(startDT),
        // Google all-day end is exclusive -> a single-day event ends the next day.
        end: allDay ? format(new Date(parseISO(date).getTime() + DAY_MS), 'yyyy-MM-dd') : localInputToISO(endDT),
        // Don't stamp Larvis props onto foreign calendars; keep todo linkage on edit.
        ...(isLarvis
          ? {
              project_id: projectId,
              // Ohne geladene Orte die bestehende Zuordnung nicht anfassen.
              place_id: places ? place?.id ?? null : undefined,
              tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
              todo_id: event?.todo_id ?? undefined,
            }
          : {}),
      };
      if (event) await updateEvent(event.id, input, event.calendar_id);
      else await createEvent(input);
      saved();
      onSaved();
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!event) return;
    setBusy(true);
    try {
      await deleteEvent(event.id, { calendarId: event.calendar_id, todoId: event.todo_id });
      onSaved();
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={event ? (readOnly ? 'Termin' : 'Termin bearbeiten') : 'Neuer Termin'}
      footer={
        readOnly ? (
          <>
            {event?.html_link && (
              <Button variant="ghost" onClick={() => window.open(event.html_link!, '_blank', 'noopener,noreferrer')} style={{ marginRight: 'auto' }}>
                <ExternalLink size={16} /> {isSubscription ? 'Link öffnen' : 'In Google öffnen'}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>Schließen</Button>
          </>
        ) : (
          <>
            {event && (
              <Button variant="ghost" onClick={remove} disabled={busy} style={{ color: 'var(--danger)', marginRight: 'auto' }}>
                <Trash2 size={16} /> Löschen
              </Button>
            )}
            {event?.html_link && (
              <Button variant="ghost" onClick={() => window.open(event.html_link!, '_blank', 'noopener,noreferrer')}>
                <ExternalLink size={16} /> Google
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" onClick={save} disabled={busy}>Speichern</Button>
          </>
        )
      }
    >
      {readOnly ? (
        <div className="stack gap-sm">
          <div className="item-row__title">{event?.summary}</div>
          {event && <div style={{ fontSize: 14 }}>{describeWhen(event)}</div>}
          <div className="text-muted" style={{ fontSize: 13 }}>
            {isSubscription
              ? `Aus dem Kalender-Abo „${event?.calendar_name ?? 'Abo'}“, nur lesend. Ändern lässt sich der Termin nur in seinem Ursprungskalender.`
              : event?.calendar_name
                ? `Termin aus „${event.calendar_name}“ (schreibgeschützt). Bearbeiten in Google.`
                : 'Schreibgeschützter Termin. Bearbeiten in Google.'}
          </div>
          {/* Abo-Termine erben das Projekt ihres Abos (Kalender → Kalender-Abos). */}
          {eventProject && <div style={{ fontSize: 14 }}>Projekt: {eventProject.name}</div>}
          {event?.location && <div style={{ fontSize: 14 }}>📍 {event.location}</div>}
          {event?.description && <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{event.description}</div>}
          {/* Erinnerung auch hier: eigene Zeit oder „Aus“ schreibt nur Larvis' eigene
              Einstellung, nie in den fremden Kalender. Ganztägige Termine haben keine. */}
          {event && !event.all_day && <ReminderField target={reminderTarget} />}
        </div>
      ) : (
        <div className="stack gap-sm">
          {event && !isLarvis && event.calendar_name && (
            <div className="text-muted" style={{ fontSize: 13 }}>Kalender: {event.calendar_name}</div>
          )}
          {linkedTodo && (
            <div className="text-muted" style={{ fontSize: 13 }}>
              Mit einem Todo verknüpft — Änderungen aktualisieren das Todo.
            </div>
          )}

          <TextInput placeholder="Titel" value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />

          <label className="row gap-sm center" style={{ fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            Ganztägig
          </label>

          {allDay ? (
            <DatePicker value={date} onChange={setDate} placeholder="Datum wählen" />
          ) : (
            <div className="stack gap-sm">
              <div className="stack" style={{ gap: 4 }}>
                <span className="section-title" style={{ margin: 0 }}>Beginn</span>
                <DateTimePicker value={startDT} onChange={changeStart} />
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <span className="section-title" style={{ margin: 0 }}>Ende</span>
                <DateTimePicker value={endDT} onChange={changeEnd} />
              </div>
            </div>
          )}

          {/* Erinnerung: nur bei getimten Terminen (Standard = Vorlauf des Termin-
              Themas, bei Terminen ohne Vorlauf-Nachricht keine Nachricht; ein ToDo-Spiegel
              stellt die Erinnerung seines ToDos ein). Für einen neuen Termin erst nach dem
              Speichern einstellbar. */}
          {!allDay && (
            <ReminderField
              target={reminderTarget}
              placeholder="Nach dem Speichern einstellbar"
            />
          )}

          {isLarvis && (
            <div>
              <div className="section-title" style={{ margin: '0 0 6px' }}>Projekt</div>
              <select className="input" value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)}>
                <option value="">Kein Projekt</option>
                {selectableProjects(projects, projectId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="stack" style={{ gap: 4 }}>
            <TextInput
              placeholder="Ort (optional)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              list="larvis-places"
              autoComplete="off"
            />
            <datalist id="larvis-places">
              {(places ?? []).map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            {isLarvis && place && (
              <div className="text-muted row gap-xs center" style={{ fontSize: 13 }}>
                <MapPin size={13} /> {placeHint(place)}
              </div>
            )}
          </div>
          <TextArea placeholder="Notiz (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          {isLarvis && (
            <TextInput placeholder="Tags, kommagetrennt" value={tags} onChange={(e) => setTags(e.target.value)} />
          )}
        </div>
      )}
    </Drawer>
  );
}
