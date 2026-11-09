import type { Contact } from './types.js';

/**
 * Apple exportiert Geburtstage ohne bekanntes Jahr mit diesem Platzhalterjahr
 * (Beginn des gregorianischen Kalender-Zyklus in iCal). Beim Import setzen wir
 * dann birthday_year_known=false, das Jahr bleibt als Platzhalter gespeichert.
 */
export const BIRTHDAY_YEAR_PLACEHOLDER = 1604;

/** Anzeigename: "Vorname Nachname", notfalls Spitzname oder "(ohne Namen)". */
export function contactName(c: Pick<Contact, 'first_name' | 'last_name' | 'nickname'>): string {
  const full = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return full || c.nickname || '(ohne Namen)';
}

export interface UpcomingBirthday {
  /** Nächstes Vorkommen des Geburtstags (heute zählt als 0 Tage entfernt). */
  next: Date;
  daysUntil: number;
  /** Alter, das die Person an diesem Geburtstag erreicht — null bei unbekanntem Jahr. */
  turnsAge: number | null;
}

/**
 * Nächster Geburtstag relativ zu `today` (lokale Zeit). 29. Februar wird in
 * Nicht-Schaltjahren am 28. Februar gefeiert — wie Googles Geburtstagsregel.
 */
export function upcomingBirthday(c: Pick<Contact, 'birthday' | 'birthday_year_known'>, today = new Date()): UpcomingBirthday | null {
  if (!c.birthday) return null;
  const [year, month, day] = c.birthday.split('-').map(Number);
  if (!month || !day) return null;

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const occurrence = (y: number) => {
    const clampedDay = month === 2 && day === 29 && !isLeapYear(y) ? 28 : day;
    return new Date(y, month - 1, clampedDay);
  };

  let next = occurrence(startOfToday.getFullYear());
  if (next < startOfToday) next = occurrence(startOfToday.getFullYear() + 1);

  const daysUntil = Math.round((next.getTime() - startOfToday.getTime()) / 86_400_000);
  const turnsAge = c.birthday_year_known && year !== BIRTHDAY_YEAR_PLACEHOLDER ? next.getFullYear() - year : null;
  return { next, daysUntil, turnsAge };
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
