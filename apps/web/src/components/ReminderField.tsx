import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { clsx } from 'clsx';
import { ReminderModal } from './ReminderModal';
import { useNotificationPrefs } from '../lib/notifications';
import { describeReminder, getReminder, type ReminderRow, type ReminderTarget } from '../lib/reminders';

interface Props {
  /** null while the target isn't ready yet (e.g. an unsaved todo). */
  target: ReminderTarget | null;
  /** Shown instead of the control when there's no target yet. */
  placeholder?: string;
}

/**
 * "Erinnerung" block for the event/todo editors: a bell trigger (styled like the
 * date/time pickers) showing the current state, opening the ReminderModal. Ohne
 * eigene Einstellung zeigt das Label den Standard des Themas; es folgt damit
 * auch Änderungen am Ziel (Uhrzeit, ganztägig) und an der Themen-Auswahl.
 */
export function ReminderField({ target, placeholder = 'Erst speichern' }: Props) {
  const [open, setOpen] = useState(false);
  // undefined = noch nicht geladen, null = keine eigene Einstellung.
  const [row, setRow] = useState<ReminderRow | null | undefined>(undefined);
  const { prefs } = useNotificationPrefs();

  // (Re)load the current reminder whenever the target changes or we save.
  async function reload() {
    if (!target) return setRow(undefined);
    setRow(await getReminder(target));
  }
  useEffect(() => {
    let active = true;
    if (!target) {
      setRow(undefined);
      return;
    }
    getReminder(target).then((r) => {
      if (active) setRow(r);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind, target && (target.kind === 'event' ? target.eventId : target.todoId), target?.start]);

  const state = target && row !== undefined ? describeReminder(row, target, prefs) : null;
  const dim = !state || !state.active;
  // Durchgestrichen, wenn eine Einstellung nichts schickt (Aus, Standard aus); gilt für diese Art Eintrag keine Regel (ohne Datum, stiller Termin), nur gedimmt.
  const Icon = state && !state.active && state.mode !== 'none' ? BellOff : Bell;

  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="section-title" style={{ margin: 0 }}>Erinnerung</span>
      <button
        type="button"
        className={clsx('dtp-trigger', dim && 'dtp-trigger--empty')}
        disabled={!target}
        onClick={() => setOpen(true)}
      >
        <Icon size={15} className="dtp-trigger__icon" />
        <span className="dtp-trigger__label">{target ? state?.label ?? '…' : placeholder}</span>
      </button>

      <ReminderModal open={open} onClose={() => setOpen(false)} target={target} prefs={prefs} onSaved={reload} />
    </div>
  );
}
