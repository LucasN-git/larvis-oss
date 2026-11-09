// Termine eines Zeitfensters für den Benachrichtigungs-Tick: Google-Kalender und
// Kalender-Abos zusammengeführt. Jede Quelle läuft für sich — fällt Google aus, kommen
// die Abo-Termine trotzdem, und umgekehrt. Ohne Abhängigkeit zu Google oder Supabase,
// damit die Regeln testbar bleiben; die Loader reicht der Tick herein.
import type { CalendarEvent } from '@larvis/shared';

export interface CalendarSourceError {
  /**
   * google        Google nicht lesbar
   * subscriptions die Abo-Tabelle nicht lesbar (Datenbank)
   * feed          ein einzelnes Abo ohne gelesenen Stand; steht schon in seinem last_error
   */
  source: 'google' | 'subscriptions' | 'feed';
  message: string;
}

export interface CalendarWindow {
  /** Termine aller lesbaren Quellen, unsortiert (die Verbraucher filtern bzw. sortieren selbst). */
  events: CalendarEvent[];
  /** Quellen, deren Termine gerade fehlen — die Termine der übrigen stehen in events. */
  errors: CalendarSourceError[];
}

/** Ausschnitt aus listSubscriptionEvents (@larvis/shared/ics), der hier gebraucht wird. */
export interface SubscriptionWindow {
  events: CalendarEvent[];
  errors: { name: string; error: string; stale: boolean }[];
  /** Anzahl eingeschalteter Abos. */
  subscriptions: number;
  /** Abo-Tabelle nicht lesbar; dann ist unbekannt, ob es Abos gibt. */
  listError: string | null;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Fehler, die der Tick als eigene Fehler meldet (ok: false): Google und die Datenbank.
 * Ein einzelnes kaputtes Abo nicht — das hält calendar_subscriptions.last_error fest und
 * die App zeigt es beim Abo, sonst stünde der Tick im Minutentakt auf ok: false.
 */
export function tickErrors(errors: CalendarSourceError[]): CalendarSourceError[] {
  return errors.filter((e) => e.source !== 'feed');
}

/** Keine eingerichtete Quelle war lesbar; errors sagt, welche gescheitert sind. */
export class CalendarUnreadableError extends Error {
  readonly errors: CalendarSourceError[];
  constructor(errors: CalendarSourceError[]) {
    super(errors.map((e) => e.message).join('; '));
    this.name = 'CalendarUnreadableError';
    this.errors = errors;
  }
}

/**
 * Führt Google und Abos für ein Fenster zusammen.
 *   null      keine Quelle eingerichtet (Google nicht verbunden, kein eingeschaltetes Abo)
 *   wirft     CalendarUnreadableError: jede eingerichtete Quelle ist gescheitert, kein Termin
 *   sonst     die lesbaren Termine plus die Fehler der übrigen Quellen
 * Ein Abo, das nach einem gescheiterten Abruf seinen letzten gelesenen Stand liefert, zählt
 * als lesbar: seine Termine sind da.
 */
export async function loadCalendarWindow(sources: {
  /** Google-Termine; null = Google nicht verbunden. */
  google: () => Promise<CalendarEvent[] | null>;
  subscriptions: () => Promise<SubscriptionWindow>;
}): Promise<CalendarWindow | null> {
  const [google, subs] = await Promise.all([
    sources.google().then(
      (events) => ({ events, error: null as string | null }),
      (e: unknown) => ({ events: [] as CalendarEvent[], error: errorText(e) }),
    ),
    sources.subscriptions(),
  ]);

  const googleConnected = google.events !== null || google.error !== null;
  if (!googleConnected && subs.subscriptions === 0 && !subs.listError) return null;

  const missing = subs.errors.filter((e) => !e.stale);
  const errors: CalendarSourceError[] = [
    ...(google.error ? [{ source: 'google' as const, message: `Google: ${google.error}` }] : []),
    ...(subs.listError ? [{ source: 'subscriptions' as const, message: subs.listError }] : []),
    ...missing.map((e) => ({ source: 'feed' as const, message: `Abo „${e.name}“: ${e.error}` })),
  ];
  const events = [...(google.events ?? []), ...subs.events];

  const googleOk = google.events !== null && !google.error;
  const subsOk = subs.subscriptions > missing.length;
  if (!googleOk && !subsOk && !events.length) throw new CalendarUnreadableError(errors);
  return { events, errors };
}
