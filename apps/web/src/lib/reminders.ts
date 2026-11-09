// Einzel-Erinnerungen für Termine und ToDos: dünne supabase-js-Wrapper über die
// `reminders`-Tabelle. Jede Zeile ist eine Nutzer-Einstellung für genau ein
// Ziel; verschickt wird serverseitig (api/notifications/tick), jede Nachricht
// steht danach in notification_log.
//
// Datenmodell pro Ziel: höchstens eine Zeile (Unique-Index je Ziel).
//   keine Zeile            -> Standard: die Regel des Themas (Termine bzw. ToDos), wann immer sie greift
//   notify_at = <zeit>     -> eigene Zeit; gilt auch, wenn das Thema aus ist
//   notify_at = null       -> aus: keine Nachricht für dieses Ziel, auch kein Standard
import { format, parseISO, subMinutes } from 'date-fns';
import { de } from 'date-fns/locale';
import type { Database } from '@larvis/shared';
import { isAllDayDue } from './format';
import { leadLabel, reminderAppliesTo, type NotificationPrefs } from './notifications';
import { supabase } from './supabase';

export type ReminderRow = Database['public']['Tables']['reminders']['Row'];
type ReminderInsert = Database['public']['Tables']['reminders']['Insert'];

export interface EventTarget {
  kind: 'event';
  eventId: string;
  calendarId: string;
  title: string;
  /** Event start (ISO datetime). */
  start: string;
  leadNotifiable: boolean;
}
export interface TodoTarget {
  kind: 'todo';
  todoId: string;
  title: string;
  /** Fälligkeit wie in todos.due_at (ganztägig = UTC-Mitternacht), null ohne Datum. */
  start: string | null;
}
export type ReminderTarget = EventTarget | TodoTarget;

export type ReminderMode = 'default' | 'custom' | 'off' | 'none';

/**
 * Was für ein Ziel ohne eigene Einstellung („Standard") gilt:
 *   lead    Vorlauf des Themas — Termine und ToDos mit Uhrzeit; enabled = Thema an
 *   allDay  ganztägig fälliges ToDo: Sammelnachricht am Tag um time (Thema an, Uhrzeit gewählt)
 *   none    gerade greift keine Regel; reason sagt, warum:
 *             undated        ToDo ohne Fälligkeit
 *             allDayNoBatch  ganztägig fälliges ToDo, Thema an, keine Uhrzeit für die Sammelnachricht
 *             todosOff       ganztägig fälliges ToDo, ToDo-Thema aus
 *             quietEvent     Termin, der keine Vorlauf-Nachricht bekommt (isLeadNotifiable)
 * Auch bei none bleibt „Standard" die Regel des Themas: Ändern sich Fälligkeit oder
 * Themen-Auswahl, greift sie ohne weiteres Zutun.
 */
export type ReminderDefault =
  | { kind: 'lead'; enabled: boolean; leadMinutes: number }
  | { kind: 'allDay'; time: string }
  | { kind: 'none'; reason: 'undated' | 'allDayNoBatch' | 'todosOff' | 'quietEvent' };

export function reminderDefault(target: ReminderTarget, prefs: NotificationPrefs): ReminderDefault {
  if (target.kind === 'event') {
    if (!target.leadNotifiable) return { kind: 'none', reason: 'quietEvent' };
    return { kind: 'lead', enabled: prefs.events.enabled, leadMinutes: prefs.events.leadMinutes };
  }
  if (!target.start) return { kind: 'none', reason: 'undated' };
  if (!isAllDayDue(target.start)) {
    return { kind: 'lead', enabled: prefs.todos.enabled, leadMinutes: prefs.todos.leadMinutes };
  }
  const { enabled, allDayTime } = prefs.todos;
  if (!enabled) return { kind: 'none', reason: 'todosOff' };
  return allDayTime ? { kind: 'allDay', time: allDayTime } : { kind: 'none', reason: 'allDayNoBatch' };
}

export interface ReminderState {
  mode: ReminderMode;
  /** Absolute notify time (ISO) when mode === 'custom'. */
  notifyAt: string | null;
  label: string;
  /** False, wenn für das Ziel nichts verschickt wird („Aus", „Standard aus", Standard ohne greifende Regel). */
  active: boolean;
}

/** Modus und Label für die Glocke im Editor — aus der Einstellung des Ziels und der Themen-Auswahl. */
export function describeReminder(
  row: ReminderRow | null,
  target: ReminderTarget,
  prefs: NotificationPrefs,
): ReminderState {
  if (row) {
    if (!row.notify_at) return { mode: 'off', notifyAt: null, label: 'Aus', active: false };
    const label = format(parseISO(row.notify_at), 'd. MMM, HH:mm', { locale: de });
    return { mode: 'custom', notifyAt: row.notify_at, label, active: true };
  }
  const def = reminderDefault(target, prefs);
  if (def.kind === 'lead') {
    if (!def.enabled) return { mode: 'default', notifyAt: null, label: 'Standard aus', active: false };
    const label = def.leadMinutes === 0 ? leadLabel(0) : `${leadLabel(def.leadMinutes)} vorher`;
    return { mode: 'default', notifyAt: null, label, active: true };
  }
  if (def.kind === 'allDay') return { mode: 'default', notifyAt: null, label: `Am Tag um ${def.time}`, active: true };
  if (def.reason === 'todosOff' || def.reason === 'allDayNoBatch') {
    return { mode: 'default', notifyAt: null, label: 'Standard aus', active: false };
  }
  return { mode: 'none', notifyAt: null, label: 'Keine Erinnerung', active: false };
}

/**
 * Vorbelegung für „Eigene Zeit": der Zeitpunkt, den der Themen-Standard hätte;
 * ohne Datum oder wenn dieser Zeitpunkt schon vorbei ist, jetzt.
 */
export function defaultCustomTime(target: ReminderTarget, prefs: NotificationPrefs): Date {
  if (!target.start) return new Date();
  const start = parseISO(target.start);
  let at: Date;
  if (target.kind === 'event') at = subMinutes(start, prefs.events.leadMinutes);
  else if (!isAllDayDue(target.start)) at = subMinutes(start, prefs.todos.leadMinutes);
  // Ganztägig: am Fälligkeitstag zur Sammel-Uhrzeit (ohne gewählte 09:00), Ortszeit.
  else at = new Date(`${target.start.slice(0, 10)}T${prefs.todos.allDayTime ?? '09:00'}`);
  return at.getTime() > Date.now() ? at : new Date();
}

/** Common column set written for either target kind. */
function baseRow(target: ReminderTarget) {
  return target.kind === 'event'
    ? {
        kind: 'event' as const,
        event_id: target.eventId,
        calendar_id: target.calendarId,
        todo_id: null,
        title: target.title,
        start_at: target.start,
      }
    : {
        kind: 'todo' as const,
        event_id: null,
        calendar_id: null,
        todo_id: target.todoId,
        title: target.title,
        start_at: target.start,
      };
}

/** Die gespeicherte Zeile eines Ziels, auch wenn sie nicht mehr gilt. */
async function storedReminder(target: ReminderTarget): Promise<ReminderRow | null> {
  const q = supabase.from('reminders').select('*');
  const { data } = await (target.kind === 'event'
    ? q.eq('kind', 'event').eq('event_id', target.eventId).eq('calendar_id', target.calendarId)
    : q.eq('kind', 'todo').eq('todo_id', target.todoId)
  ).maybeSingle();
  return (data as ReminderRow | null) ?? null;
}

/**
 * Die Einstellung für ein Ziel, null ohne eigene Einstellung. Eine eigene Zeit an einem
 * inzwischen verschobenen Abo-Termin gilt nicht mehr (reminderAppliesTo): dann null, wie
 * der Tick es sieht.
 */
export async function getReminder(target: ReminderTarget): Promise<ReminderRow | null> {
  const row = await storedReminder(target);
  if (row && target.kind === 'event' && !reminderAppliesTo(row, target.start)) return null;
  return row;
}

/**
 * Schreibt die Einstellung für ein Ziel: die vorhandene Zeile aktualisieren,
 * sonst anlegen. notifyAt = null schaltet das Ziel stumm. sent_at wird
 * zurückgesetzt, weil der Tick eigene Zeiten darüber beansprucht — eine
 * geänderte Zeit muss wieder frei sein.
 */
async function writeOverride(target: ReminderTarget, notifyAt: string | null): Promise<void> {
  const patch: ReminderInsert = { ...baseRow(target), custom: true, notify_at: notifyAt, sent_at: null };
  // Die gespeicherte Zeile, auch eine nicht mehr geltende: je Ziel gibt es höchstens eine.
  const existing = await storedReminder(target);
  const { error } = existing
    ? await supabase.from('reminders').update(patch).eq('id', existing.id)
    : await supabase.from('reminders').insert(patch);
  if (error) throw new Error(error.message);
}

/** Set an explicit reminder time (ISO). */
export function setCustomReminder(target: ReminderTarget, notifyAtISO: string): Promise<void> {
  return writeOverride(target, notifyAtISO);
}

/** Aus: keine Nachricht für dieses Ziel, auch nicht die des Themas. */
export function muteReminder(target: ReminderTarget): Promise<void> {
  return writeOverride(target, null);
}

/** Entfernt die eigene Einstellung; danach gilt wieder der Standard des Themas. */
export async function clearReminder(target: ReminderTarget): Promise<void> {
  const del = supabase.from('reminders').delete();
  const { error } = await (target.kind === 'event'
    ? del.eq('kind', 'event').eq('event_id', target.eventId).eq('calendar_id', target.calendarId)
    : del.eq('kind', 'todo').eq('todo_id', target.todoId));
  if (error) throw new Error(error.message);
}
