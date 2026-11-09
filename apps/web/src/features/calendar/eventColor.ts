import type { CalendarEvent } from '@larvis/shared';

/**
 * Anzeigefarbe eines Termins: die wirksame Projektfarbe (Unterprojekte erben,
 * siehe projectColorMap), sonst Akzent für den Larvis-Kalender, sonst die eigene
 * Farbe des Fremdkalenders (Google-Farbe bzw. Farbe des Kalender-Abos), damit
 * Arbeit/Privat unterscheidbar bleiben. Termine eines Kalender-Abos mit Projekt tragen
 * dessen project_id und färben sich deshalb wie Projekttermine.
 */
export function eventColorOf(
  ev: Pick<CalendarEvent, 'project_id' | 'calendar' | 'color'>,
  colorMap: Map<string, string | null>,
): string {
  const c = ev.project_id ? colorMap.get(ev.project_id) : null;
  if (c) return c;
  if (ev.calendar === 'larvis') return 'var(--accent)';
  return ev.color ?? 'var(--text-faint)';
}
