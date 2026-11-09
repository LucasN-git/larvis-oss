// Obergrenze der ToDo-Liste auf Heute: mehr Zeilen stehen hinter „Alle anzeigen".
export const HOME_TODO_CAP = 25;

/** Schneidet eine Liste auf höchstens `cap` Zeilen; ohne `cap` bleibt sie ganz. */
export function capRows<T>(rows: T[], cap?: number): { visible: T[]; hidden: number } {
  if (cap === undefined || rows.length <= cap) return { visible: rows, hidden: 0 };
  const n = Math.max(0, cap);
  return { visible: rows.slice(0, n), hidden: rows.length - n };
}
