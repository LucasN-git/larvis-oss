import { format, formatDistanceToNowStrict, isPast, isThisYear, isToday, isTomorrow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import type { Priority } from '@larvis/shared';

/** A due stored at exactly UTC midnight carries no time-of-day → "all-day".
 *  This matches the calendar mapping in @larvis/shared (todoToEventInput). */
export function isAllDayDue(dueAt: string): boolean {
  const d = parseISO(dueAt);
  return !Number.isNaN(d.getTime()) && d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
}

/** True when the due date falls on the local "today" — drives the Sonnen-Toggle. */
export function isDueToday(dueAt: string | null): boolean {
  if (!dueAt) return false;
  const d = parseISO(dueAt);
  return !Number.isNaN(d.getTime()) && isToday(d);
}

/** Today's date as an all-day due (UTC midnight), the value the Heute-Toggle writes. */
export function todayDueIso(): string {
  return `${format(new Date(), 'yyyy-MM-dd')}T00:00:00.000Z`;
}

export function formatDue(due: string | null): { label: string; overdue: boolean } | null {
  if (!due) return null;
  const d = parseISO(due);
  const overdue = isPast(d) && !isToday(d);
  const time = isAllDayDue(due) ? '' : ` ${format(d, 'HH:mm', { locale: de })}`;
  if (isToday(d)) return { label: `Heute${time}`, overdue: false };
  if (isTomorrow(d)) return { label: `Morgen${time}`, overdue: false };
  const label = format(d, isThisYear(d) ? 'EEE, d. MMM' : 'd. MMM yyyy', { locale: de }) + time;
  return { label, overdue };
}

export function formatRelative(iso: string): string {
  return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true, locale: de });
}

export function formatEventTime(start: string, allDay: boolean): string {
  const d = parseISO(start);
  if (allDay) return format(d, 'd. MMM', { locale: de });
  return format(d, 'HH:mm', { locale: de });
}

export function formatDateHeading(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return 'Heute';
  if (isTomorrow(d)) return 'Morgen';
  return format(d, 'EEEE, d. MMMM', { locale: de });
}

const PRIORITY_VARS: Record<Priority, string> = {
  0: 'var(--text-faint)',
  1: 'var(--success)',
  2: 'var(--warning)',
  3: 'var(--danger)',
};
export const priorityColor = (p: Priority): string => PRIORITY_VARS[p] ?? PRIORITY_VARS[0];

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: 'Keine',
  1: 'Niedrig',
  2: 'Mittel',
  3: 'Hoch',
};
