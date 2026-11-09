// Runtime-local copy of the pure calendar helpers from @larvis/shared.
// The API handlers are bundled from apps/web (scripts/build-api.mjs) and keep
// the workspace package out of their runtime, so it can't be a *value* import
// (only types, which are erased). Keep this in sync with packages/shared/src/calendar.ts.
import type { EventInput, Todo } from '@larvis/shared';

// Google's fixed event color palette (colorId -> hex).
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6bf26',
  '6': '#f4511e',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000',
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Projektpalette -> feste Google-colorId.
// Kopie von packages/shared PROJECT_PALETTE — synchron halten.
export const PALETTE_GOOGLE_COLOR: Record<string, string> = {
  '#14b8a6': '2',
  '#2e9e4f': '10',
  '#d4a21a': '5',
  '#8b919a': '8',
  '#f2811d': '6',
  '#2f55c6': '9',
  '#0a8cff': '7',
  '#8b5cf6': '3',
  '#e0571f': '11',
};

/**
 * Google colorId for a hex colour: a palette colour maps to its fixed colorId,
 * any other hex to the nearest Google colour; null if unparseable.
 */
export function hexToGoogleColorId(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const palette = PALETTE_GOOGLE_COLOR[hex.trim().toLowerCase()];
  if (palette) return palette;
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

/** Map a todo to its mirrored event input, or null if it shouldn't have one. */
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
    end = new Date(due.getTime() + DAY_MS).toISOString().slice(0, 10);
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
