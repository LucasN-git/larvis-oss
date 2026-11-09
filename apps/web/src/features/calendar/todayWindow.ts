const DAY_MS = 86_400_000;

/**
 * Ladefenster der Tafel auf Heute: der lokale Kalendertag von 00:00 bis 24:00,
 * ausgedrückt in den Parametern der Kalender-API (`back`/`days` in Tagen relativ zu
 * jetzt). Die Grenzen sind echte lokale Mitternächte, darum stimmt das Fenster auch an
 * Tagen mit Zeitumstellung (23 bzw. 25 Stunden). Aufgerundet auf 1/1000 Tag, damit der
 * Rand nicht durch Rundung einen Termin um 00:00 abschneidet.
 */
export function todayWindow(now: Date): { back: number; days: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const t = now.getTime();
  return {
    back: ceil3((t - start.getTime()) / DAY_MS),
    days: ceil3((end.getTime() - t) / DAY_MS),
  };
}

function ceil3(x: number): number {
  return Math.ceil(x * 1000) / 1000;
}
