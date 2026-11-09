// Erinnerungen an Termine planen — reine Logik für MCP-Server und Web-API.
// Ein Termin hat höchstens eine Erinnerung: entweder relativ zum Beginn
// (reminder_minutes vorher) oder zu einem festen Zeitpunkt (reminder_at).
// Wer keins von beiden angibt, lässt die bestehende Erinnerung unverändert.

/** Erinnerungs-Felder eines Termin-Aufrufs. */
export interface ReminderInput {
  /** ISO-Zeitpunkt, oder YYYY-MM-DD bei ganztägigen Terminen. */
  start: string;
  all_day?: boolean;
  /** Minuten vor Beginn; null = Erinnerung stummschalten. */
  reminder_minutes?: number | null;
  /** Fester Erinnerungszeitpunkt (ISO). */
  reminder_at?: string | null;
}

export type ReminderPlan =
  | { action: 'keep' }
  | { action: 'mute'; startAt: string }
  | { action: 'set'; notifyAt: string; startAt: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UTC_MIDNIGHT = /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?(Z|\+00:00)$/;

/** Beginn eines Termins als ISO-Zeitpunkt; ganztägig = Berliner Mitternacht des Tages. */
function startInstant(input: ReminderInput): number {
  const allDay = input.all_day ?? YMD.test(input.start);
  if (allDay) {
    const ymd = input.start.slice(0, 10);
    if (!YMD.test(ymd)) throw new Error(`Ungültiges Datum für ganztägigen Termin: ${input.start}`);
    const ms = berlinWallTime(ymd, '00:00');
    if (Number.isNaN(ms)) throw new Error(`Ungültiges Datum für ganztägigen Termin: ${input.start}`);
    return ms;
  }
  const ms = Date.parse(input.start);
  if (Number.isNaN(ms)) throw new Error(`Ungültiger Terminbeginn: ${input.start}`);
  return ms;
}

/**
 * Was mit der Erinnerung eines Termins passieren soll. Wirft bei
 * widersprüchlichen oder unsinnigen Angaben, statt still etwas zu raten.
 */
export function planEventReminder(input: ReminderInput, now: number): ReminderPlan {
  const hasMinutes = input.reminder_minutes !== undefined;
  const hasAt = input.reminder_at !== undefined && input.reminder_at !== null;
  if (hasMinutes && hasAt) {
    throw new Error('Entweder reminder_minutes oder reminder_at angeben, nicht beides.');
  }
  if (!hasMinutes && !hasAt) return { action: 'keep' };

  const startMs = startInstant(input);
  const startAt = (input.all_day ?? YMD.test(input.start)) ? input.start.slice(0, 10) : new Date(startMs).toISOString();
  if (hasMinutes && input.reminder_minutes === null) return { action: 'mute', startAt };

  let notifyMs: number;
  if (hasMinutes) {
    const minutes = input.reminder_minutes as number;
    if (!Number.isFinite(minutes)) throw new Error(`Ungültige reminder_minutes: ${minutes}`);
    if (minutes < 0) throw new Error('reminder_minutes darf nicht negativ sein.');
    notifyMs = startMs - minutes * 60_000;
  } else {
    notifyMs = Date.parse(input.reminder_at as string);
    if (Number.isNaN(notifyMs)) throw new Error(`Ungültiger reminder_at: ${input.reminder_at}`);
  }
  if (notifyMs < now) {
    throw new Error(
      `Der Erinnerungszeitpunkt ${new Date(notifyMs).toISOString()} liegt in der Vergangenheit — bitte einen späteren wählen.`,
    );
  }
  return { action: 'set', notifyAt: new Date(notifyMs).toISOString(), startAt };
}

/**
 * Neuer Erinnerungszeitpunkt, wenn ein Termin verschoben wird: der Vorlauf
 * (notify_at − start_at) bleibt gleich. Stumme Erinnerung bleibt stumm (null),
 * ohne bekannten Beginn lässt sich nichts verschieben (null).
 */
export function shiftReminder(
  row: { notify_at: string | null; start_at: string | null },
  newStartAt: string,
): string | null {
  if (!row.notify_at || !row.start_at) return null;
  const dated = (YMD.test(row.start_at) || UTC_MIDNIGHT.test(row.start_at)) && YMD.test(newStartAt);
  const instant = (s: string) => (dated ? berlinWallTime(s.slice(0, 10), '00:00') : Date.parse(s));
  const lead = instant(row.start_at) - Date.parse(row.notify_at);
  const next = instant(newStartAt);
  if (Number.isNaN(lead) || Number.isNaN(next)) return null;
  return new Date(next - lead).toISOString();
}

// --- Zeit in Europe/Berlin ----------------------------------------------------
// Kopie von apps/web/api/_lib/notificationPrefs.ts — synchron halten (api/ darf shared nicht importieren).

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Berlin',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

function berlinParts(ms: number) {
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second };
}

/** Abstand Berlin–UTC zum Zeitpunkt ms (1 h im Winter, 2 h im Sommer). */
function berlinOffset(ms: number): number {
  const { y, m, d, hh, mm, ss } = berlinParts(ms);
  return Date.UTC(y, m - 1, d, hh, mm, ss) - Math.floor(ms / 1000) * 1000;
}

/**
 * Zeitpunkt (ms) einer Berliner Wanduhrzeit an einem Tag. In der
 * Umstellungsnacht, in der die Stunde fehlt oder doppelt ist, trifft es einen
 * der beiden Kandidaten.
 */
export function berlinWallTime(ymd: string, hhmm: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const asUTC = Date.UTC(y, m - 1, d, hh, mm);
  const guess = asUTC - berlinOffset(asUTC);
  return asUTC - berlinOffset(guess);
}
