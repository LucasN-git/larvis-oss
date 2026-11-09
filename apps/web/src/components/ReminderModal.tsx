import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Modal } from './Modal';
import { DateTimePicker } from './DateTimePicker';
import { Button, Segmented } from './ui';
import type { NotificationPrefs } from '../lib/notifications';
import {
  clearReminder,
  defaultCustomTime,
  describeReminder,
  getReminder,
  muteReminder,
  reminderDefault,
  setCustomReminder,
  type ReminderMode,
  type ReminderTarget,
} from '../lib/reminders';

interface Props {
  open: boolean;
  onClose: () => void;
  target: ReminderTarget | null;
  /** Themen-Auswahl: bestimmt den Standard, seine Beschreibung und die Vorbelegung der eigenen Zeit. */
  prefs: NotificationPrefs;
  /** Called after a successful write so the opener can refresh its label. */
  onSaved?: () => void;
}

const SETTINGS_PATH = 'Profil → Einstellungen → Benachrichtigungen';

// datetime-local <-> ISO (browser-local), matching the event editor's helpers.
function toLocalInput(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}
function localInputToISO(local: string): string {
  return new Date(local).toISOString();
}

/** Satz unter „Standard“: welche Regel des Themas für das Ziel gilt oder warum gerade keine greift, und wo man es einstellt. */
function defaultText(target: ReminderTarget, prefs: NotificationPrefs): string {
  const def = reminderDefault(target, prefs);
  const topic = target.kind === 'event' ? 'Termine' : 'ToDos mit Uhrzeit';
  const { label } = describeReminder(null, target, prefs);
  if (def.kind === 'allDay') {
    return `${label}, zusammen mit allen ToDos, die an dem Tag fällig sind. Ändern kannst du das unter ${SETTINGS_PATH}.`;
  }
  if (def.kind === 'lead') {
    return def.enabled
      ? `${label}, wie für alle ${topic} eingestellt. Ändern kannst du das unter ${SETTINGS_PATH}.`
      : `Automatische Nachrichten für ${target.kind === 'event' ? 'Termine' : 'ToDos'} sind aus. Einschalten kannst du sie unter ${SETTINGS_PATH}.`;
  }
  switch (def.reason) {
    case 'undated':
      return 'Ohne Fälligkeit kommt keine automatische Nachricht. Bekommt das ToDo ein Datum, gilt der Standard für ToDos.';
    case 'allDayNoBatch':
      return `Für ganztägige ToDos ist keine Sammelnachricht eingestellt. Wählst du dafür eine Uhrzeit (${SETTINGS_PATH}), kommt dieses ToDo mit.`;
    case 'todosOff':
      return `Automatische Nachrichten für ToDos sind aus. Einschalten kannst du sie unter ${SETTINGS_PATH}.`;
    case 'quietEvent':
      return 'Für diese Art Termin kommt keine automatische Nachricht (Geburtstage, Arbeitsorte, Abwesenheiten, Fokuszeiten).';
  }
}

export function ReminderModal({ open, onClose, target, prefs, onSaved }: Props) {
  const [mode, setMode] = useState<ReminderMode>('default');
  const [dt, setDt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load the current override each time the modal opens for a target. Keyed on
  // stable primitives (not the object identity) so a background re-render of the
  // parent editor — e.g. TodoEditorModal's autosave flip — can't re-run this and
  // clobber the user's unsaved selection. prefs fehlt bewusst aus demselben Grund;
  // eine später geladene Themen-Auswahl braucht keine Korrektur des Modus, weil er
  // nur an der gespeicherten Zeile hängt und „Standard“ immer angeboten wird.
  useEffect(() => {
    if (!open || !target) return;
    let active = true;
    setErr(null);
    getReminder(target).then((row) => {
      if (!active) return;
      const state = describeReminder(row, target, prefs);
      // Ohne Zeile steht die Auswahl auf „Standard“, auch wenn gerade keine Regel des Themas greift.
      setMode(state.mode === 'none' ? 'default' : state.mode);
      setDt(toLocalInput(state.notifyAt ? new Date(state.notifyAt) : defaultCustomTime(target, prefs)));
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    target?.kind,
    target && (target.kind === 'event' ? `${target.eventId}::${target.calendarId}` : target.todoId),
    target?.start,
  ]);

  if (!target) return null;

  const options: { value: ReminderMode; label: string }[] = [
    { value: 'default', label: 'Standard' },
    { value: 'custom', label: 'Eigene Zeit' },
    { value: 'off', label: 'Aus' },
  ];

  async function save() {
    if (!target || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'default') await clearReminder(target);
      else if (mode === 'off') await muteReminder(target);
      else await setCustomReminder(target, localInputToISO(dt));
      onSaved?.();
      onClose();
    } catch (e) {
      // Don't close on failure — surface the error so the choice isn't lost.
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Erinnerung"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={busy}>Speichern</Button>
        </>
      }
    >
      <div className="stack gap-md">
        <div className="text-muted" style={{ fontSize: 13 }}>{target.title || 'Ohne Titel'}</div>

        <Segmented options={options} value={mode} onChange={setMode} />

        {mode === 'custom' && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="section-title" style={{ margin: 0 }}>Benachrichtigen am</span>
            <DateTimePicker value={dt} onChange={setDt} />
          </div>
        )}

        {mode === 'default' && (
          <div className="text-muted" style={{ fontSize: 13 }}>{defaultText(target, prefs)}</div>
        )}
        {mode === 'off' && (
          <div className="text-muted" style={{ fontSize: 13 }}>
            Keine Nachricht für diesen Eintrag, auch nicht, wenn später ein Standard greift.
          </div>
        )}
        {err && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{err}</div>}
      </div>
    </Modal>
  );
}
