// Erinnerungen an Termine aus dem MCP heraus: dünne Wrapper über die
// `reminders`-Tabelle, dieselbe Semantik wie apps/web/src/lib/reminders.ts.
//
// Pro Termin (event_id + calendar_id) höchstens eine Zeile:
//   keine Zeile        -> Standard (globaler Vorlauf des Themas Termine, 30 min)
//   notify_at = <zeit> -> eigene Zeit
//   notify_at = null   -> aus, auch kein Standard
//
// Der Unique-Index ist partiell (nur kind='event'), deshalb kein upsert mit
// onConflict, sondern lesen und dann aktualisieren oder anlegen.
import type { SupabaseClient } from '@supabase/supabase-js';
import { shiftReminder, type Database, type ReminderPlan } from '@larvis/shared';

type Sb = SupabaseClient<Database>;
type ReminderRow = Database['public']['Tables']['reminders']['Row'];

interface EventRef {
  eventId: string;
  calendarId: string;
}

export interface EventReminderState {
  mode: 'default' | 'custom' | 'off';
  notify_at: string | null;
}

async function findRow(sb: Sb, { eventId, calendarId }: EventRef): Promise<ReminderRow | null> {
  const { data, error } = await sb
    .from('reminders')
    .select('*')
    .eq('kind', 'event')
    .eq('event_id', eventId)
    .eq('calendar_id', calendarId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Schreibt eine eigene Einstellung für einen Termin ('set' = Zeitpunkt,
 * 'mute' = aus). 'keep' ändert nichts. sent_at wird zurückgesetzt, damit eine
 * geänderte Zeit wieder verschickt werden kann.
 */
export async function applyEventReminder(
  sb: Sb,
  ref: EventRef & { title: string; plan: ReminderPlan },
): Promise<void> {
  const { plan } = ref;
  if (plan.action === 'keep') return;
  const patch = {
    kind: 'event',
    event_id: ref.eventId,
    calendar_id: ref.calendarId,
    todo_id: null,
    custom: true,
    notify_at: plan.action === 'set' ? plan.notifyAt : null,
    title: ref.title,
    start_at: plan.startAt,
    sent_at: null,
  };
  const existing = await findRow(sb, ref);
  const { error } = existing
    ? await sb.from('reminders').update(patch).eq('id', existing.id)
    : await sb.from('reminders').insert(patch);
  if (error) throw new Error(error.message);
}

/**
 * Zieht eine eigene Erinnerung mit, wenn der Termin verschoben oder umbenannt
 * wird: der Vorlauf bleibt gleich, eine stumme Erinnerung bleibt stumm. Ohne
 * Zeile gilt der Standard, der sich ohnehin am Beginn ausrichtet — nichts zu tun.
 */
export async function shiftEventReminder(
  sb: Sb,
  ref: EventRef & { newStartAt: string; title?: string },
): Promise<void> {
  const row = await findRow(sb, ref);
  if (!row) return;
  // Ohne bekannten alten Beginn lässt sich der Vorlauf nicht bestimmen: Zeit stehen lassen.
  const notifyAt = row.notify_at && row.start_at ? shiftReminder(row, ref.newStartAt) : row.notify_at;
  const patch: Database['public']['Tables']['reminders']['Update'] = { start_at: ref.newStartAt };
  if (ref.title !== undefined) patch.title = ref.title;
  const changed = notifyAt && row.notify_at ? Date.parse(notifyAt) !== Date.parse(row.notify_at) : notifyAt !== row.notify_at;
  if (changed) {
    patch.notify_at = notifyAt;
    patch.sent_at = null;
  }
  const { error } = await sb.from('reminders').update(patch).eq('id', row.id);
  if (error) throw new Error(error.message);
}

/** Entfernt die Einstellung eines gelöschten Termins. */
export async function deleteEventReminder(sb: Sb, ref: EventRef): Promise<void> {
  const { error } = await sb
    .from('reminders')
    .delete()
    .eq('kind', 'event')
    .eq('event_id', ref.eventId)
    .eq('calendar_id', ref.calendarId);
  if (error) throw new Error(error.message);
}

/** Stand der Erinnerung eines Termins, wie ihn die Tools zurückgeben. */
export async function readEventReminder(sb: Sb, ref: EventRef): Promise<EventReminderState> {
  const row = await findRow(sb, ref);
  if (!row) return { mode: 'default', notify_at: null };
  if (!row.notify_at) return { mode: 'off', notify_at: null };
  return { mode: 'custom', notify_at: row.notify_at };
}
