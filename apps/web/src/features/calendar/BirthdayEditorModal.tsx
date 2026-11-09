import { useState } from 'react';
import { Trash2, ExternalLink, Cake } from 'lucide-react';
import { addDays, format, parseISO } from 'date-fns';
import type { CalendarEvent, EventInput } from '@larvis/shared';
import { createEvent, deleteEvent, updateEvent } from '../../lib/calendar';
import { useToast } from '../../lib/toast';
import { Drawer } from '../../components/Drawer';
import { DatePicker } from '../../components/DateTimePicker';
import { Button, TextInput } from '../../components/ui';

interface Props {
  event: CalendarEvent | null; // null = new
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Pre-selected day for a new birthday (YYYY-MM-DD). */
  defaultDate?: string;
}

/** A recurring birthday shows up as one expanded instance — edit/delete the whole series. */
function seriesId(event: CalendarEvent): string {
  return event.recurring_event_id ?? event.id;
}

export function BirthdayEditorModal({ event, open, onClose, onSaved, defaultDate }: Props) {
  const { saved, notify } = useToast();
  const anchor = event ? event.start.slice(0, 10) : defaultDate ?? format(new Date(), 'yyyy-MM-dd');

  const [name, setName] = useState(event?.summary ?? '');
  // The picker drives day + month; the year field (optional) fixes the birth year for age display.
  const [date, setDate] = useState(anchor);
  const [year, setYear] = useState(event ? anchor.slice(0, 4) : '');
  const [busy, setBusy] = useState(false);

  const readOnly = Boolean(event && !event.editable);

  async function save() {
    if (!name.trim() || !date || busy) return;
    setBusy(true);
    try {
      // Anchor the yearly event on the birth year when known, else the picked year.
      const y = /^\d{4}$/.test(year.trim()) ? year.trim() : date.slice(0, 4);
      const start = `${y}-${date.slice(5)}`;
      const end = format(addDays(parseISO(start), 1), 'yyyy-MM-dd');
      const input: EventInput = { summary: name.trim(), start, end, all_day: true, birthday: true };
      if (event) await updateEvent(seriesId(event), input, event.calendar_id);
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
      await deleteEvent(seriesId(event), { calendarId: event.calendar_id });
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
      title={
        <span className="row gap-sm center">
          <Cake size={18} /> {event ? (readOnly ? 'Geburtstag' : 'Geburtstag bearbeiten') : 'Geburtstag'}
        </span>
      }
      footer={
        readOnly ? (
          <>
            {event?.html_link && (
              <Button variant="ghost" onClick={() => window.open(event.html_link!, '_blank')} style={{ marginRight: 'auto' }}>
                <ExternalLink size={16} /> In Google öffnen
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
            <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" onClick={save} disabled={busy}>Speichern</Button>
          </>
        )
      }
    >
      {readOnly ? (
        <div className="stack gap-sm">
          <div className="item-row__title">🎂 {event?.summary}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>Schreibgeschützt. Bearbeiten in Google.</div>
        </div>
      ) : (
        <div className="stack gap-sm">
          <div className="text-muted" style={{ fontSize: 13 }}>
            Wird als jährlicher Geburtstag in deinem Google-Kalender gespeichert.
          </div>

          <TextInput placeholder="Name (z. B. Mama)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

          <div className="stack" style={{ gap: 4 }}>
            <span className="section-title" style={{ margin: 0 }}>Tag & Monat</span>
            <DatePicker value={date} onChange={setDate} placeholder="Datum wählen" />
          </div>

          <div className="stack" style={{ gap: 4 }}>
            <span className="section-title" style={{ margin: 0 }}>Geburtsjahr (optional)</span>
            <TextInput
              inputMode="numeric"
              placeholder="z. B. 1990"
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </div>
        </div>
      )}
    </Drawer>
  );
}
