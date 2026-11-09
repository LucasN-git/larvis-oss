// Calendar write-side helpers shared by the web serverless functions and the
// MCP server. Pure functions only — each runtime does its own Google fetch.
import type { Todo } from './types.js';
import { PROJECT_PALETTE } from './projects.js';

/** Payload for creating/patching a Google Calendar event (provider-agnostic shape). */
export interface EventInput {
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO datetime, or YYYY-MM-DD for all-day
  end: string; // ISO datetime, or YYYY-MM-DD (exclusive) for all-day
  all_day?: boolean;
  project_id?: string | null;
  tags?: string[];
  /** Set when the event mirrors a todo; stored in extendedProperties for round-tripping. */
  todo_id?: string | null;
  /**
   * When true, create/patch a real Google birthday: an all-day, yearly-recurring
   * event (eventType "birthday") on the user's primary calendar. `start`/`end`
   * must be YYYY-MM-DD; recurrence, transparency and visibility are set by the
   * server. Birthday events cannot carry location/description/project/tags.
   */
  birthday?: boolean;
  /** Larvis-Ort (places.id), stored in extendedProperties. */
  place_id?: string | null;
}

/**
 * Annual recurrence rule for a birthday anchored on `date` (YYYY-MM-DD).
 * Feb 29 birthdays recur on the last day of February so non-leap years still fire.
 */
export function birthdayRecurrence(date: string): string[] {
  const [, m, d] = date.split('-').map(Number);
  if (m === 2 && d === 29) return ['RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1'];
  return ['RRULE:FREQ=YEARLY'];
}

// Google's fixed event color palette (colorId -> hex). Used to map a project's
// arbitrary hex colour to the nearest Google colour so events look right in
// Google's own UI too.
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb', // Lavender
  '2': '#33b679', // Sage
  '3': '#8e24aa', // Grape
  '4': '#e67c73', // Flamingo
  '5': '#f6bf26', // Banana
  '6': '#f4511e', // Tangerine
  '7': '#039be5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3f51b5', // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d50000', // Tomato
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Google colorId for a hex colour: a PROJECT_PALETTE colour maps to its fixed
 * googleColorId, any other hex to the nearest Google colour; null if unparseable.
 */
export function hexToGoogleColorId(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const wanted = hex.trim().toLowerCase();
  const palette = PROJECT_PALETTE.find((c) => c.hex.toLowerCase() === wanted);
  if (palette) return palette.googleColorId;
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [id, chex] of Object.entries(GOOGLE_EVENT_COLORS)) {
    const c = hexToRgb(chex)!;
    const dist = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = id;
    }
  }
  return best;
}

const DAY_MS = 86_400_000;
const TODO_SLOT_MIN = 30;

/**
 * Map a todo to the calendar event it should produce, or null if it shouldn't
 * have one (no due date). "Automatik": a due time of exactly midnight (UTC)
 * becomes an all-day entry; any other time becomes a 30-minute slot.
 * Done todos keep their entry but get a ✓ prefix.
 */
export function todoToEventInput(
  todo: Pick<Todo, 'id' | 'title' | 'due_at' | 'status' | 'project_id' | 'tags'>,
): EventInput | null {
  if (!todo.due_at) return null;
  const due = new Date(todo.due_at);
  if (Number.isNaN(due.getTime())) return null;

  const summary = (todo.status === 'done' ? '✓ ' : '') + (todo.title || 'Todo');
  const allDay = due.getUTCHours() === 0 && due.getUTCMinutes() === 0;

  let start: string;
  let end: string;
  if (allDay) {
    start = due.toISOString().slice(0, 10);
    end = new Date(due.getTime() + DAY_MS).toISOString().slice(0, 10); // Google all-day end is exclusive
  } else {
    start = due.toISOString();
    end = new Date(due.getTime() + TODO_SLOT_MIN * 60_000).toISOString();
  }

  return {
    summary,
    start,
    end,
    all_day: allDay,
    project_id: todo.project_id ?? null,
    tags: todo.tags ?? [],
    todo_id: todo.id,
  };
}

/**
 * Kalender-Abos (read-only ICS) tragen als calendar_id `sub:<abo-id>` und als Termin-id
 * `sub:<abo-id>:<hash>`. Am Präfix erkennen die Schreibwege (API, MCP), dass ein Termin
 * aus einem Abo stammt und nicht verändert werden darf.
 */
export const SUBSCRIPTION_ID_PREFIX = 'sub:';

/** True für calendar_ids und Termin-ids aus einem Kalender-Abo. */
export function isSubscriptionId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(SUBSCRIPTION_ID_PREFIX);
}

const BERLIN_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' });

/** Berliner Kalendertag (YYYY-MM-DD) eines Beginns; ganztägige tragen ihn direkt. */
function startDay(e: { start: string; all_day?: boolean }): string {
  if (e.all_day || e.start.length === 10) return e.start.slice(0, 10);
  const ms = Date.parse(e.start);
  return Number.isNaN(ms) ? e.start.slice(0, 10) : BERLIN_DAY.format(ms);
}

/**
 * Sortierung nach Beginn: erst nach Berliner Tag, am selben Tag ganztägige zuerst, dann
 * nach Zeitpunkt — nicht nach Text, denn Google liefert Offsets (`+02:00`), Abos UTC (`Z`).
 * Gleicher Zeitpunkt → Text.
 */
export function compareEventStart(
  a: { start: string; all_day?: boolean },
  b: { start: string; all_day?: boolean },
): number {
  const dayA = startDay(a);
  const dayB = startDay(b);
  if (dayA !== dayB) return dayA < dayB ? -1 : 1;
  if (Boolean(a.all_day) !== Boolean(b.all_day)) return a.all_day ? -1 : 1;
  const diff = Date.parse(a.start) - Date.parse(b.start);
  return Number.isNaN(diff) || diff === 0 ? a.start.localeCompare(b.start) : diff;
}
