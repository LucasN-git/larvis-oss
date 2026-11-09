import type { CalendarEvent, CalendarSource, EventInput, Todo } from '@larvis/shared';
import { effectiveProjectColor, hexToGoogleColorId, todoToEventInput } from '@larvis/shared';
import { db } from './supabase.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';
const LARVIS_CALENDAR_NAME = 'Larvis';
const CAL_TIMEZONE = 'Europe/Berlin';

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  colorId?: string;
  eventType?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

type Account = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expiry: string | null;
  larvis_calendar_id: string | null;
};

/** Resolve the connected account + a valid access token (refreshing if needed). */
async function auth(): Promise<{ acct: Account; token: string }> {
  if (!googleConfigured()) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in MCP env.');

  const { data: acct, error } = await db
    .from('calendar_accounts')
    .select('id, access_token, refresh_token, expiry, larvis_calendar_id')
    .eq('provider', 'google')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!acct?.refresh_token) throw new Error('Google Calendar not connected. Connect it in the Larvis web app first.');

  const stillValid = acct.access_token && acct.expiry && new Date(acct.expiry).getTime() - 60_000 > Date.now();
  if (stillValid) return { acct, token: acct.access_token! };

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: acct.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  await db
    .from('calendar_accounts')
    .update({ access_token: json.access_token, expiry: new Date(Date.now() + json.expires_in * 1000).toISOString() })
    .eq('id', acct.id);
  return { acct, token: json.access_token };
}

async function api(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${await res.text()}`);
  return res.json();
}

async function ensureLarvisCalendar(acct: Account, token: string): Promise<string> {
  if (acct.larvis_calendar_id) return acct.larvis_calendar_id;
  const list = (await api(token, '/users/me/calendarList')) as { items?: { id: string; summary?: string }[] };
  let id = list.items?.find((c) => c.summary === LARVIS_CALENDAR_NAME)?.id;
  if (!id) {
    const created = (await api(token, '/calendars', {
      method: 'POST',
      body: JSON.stringify({ summary: LARVIS_CALENDAR_NAME, timeZone: CAL_TIMEZONE }),
    })) as { id: string };
    id = created.id;
  }
  await db.from('calendar_accounts').update({ larvis_calendar_id: id }).eq('id', acct.id);
  acct.larvis_calendar_id = id;
  return id;
}

/** Wirksame Projektfarbe (ein Unterprojekt ohne eigene Farbe erbt die des Elternprojekts). */
async function projectColor(projectId: string | null | undefined): Promise<string | null> {
  if (!projectId) return null;
  const { data } = await db.from('projects').select('id, parent_id, color').is('deleted_at', null);
  return effectiveProjectColor(data ?? [], projectId);
}

/** Metadata about a source calendar, carried onto each of its events. */
interface CalMeta {
  id: string;
  name: string | null;
  color: string | null;
  editable: boolean;
  source: CalendarSource;
}

function normalize(e: GoogleEvent, cal: CalMeta): CalendarEvent {
  const priv = e.extendedProperties?.private ?? {};
  return {
    id: e.id,
    summary: e.summary ?? '(ohne Titel)',
    description: e.description ?? null,
    location: e.location ?? null,
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    all_day: Boolean(e.start?.date && !e.start?.dateTime),
    html_link: e.htmlLink ?? null,
    calendar: cal.source,
    calendar_id: cal.id,
    calendar_name: cal.name,
    color: cal.color,
    editable: cal.editable,
    project_id: priv.larvis_project_id || null,
    tags: priv.larvis_tags ? priv.larvis_tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    todo_id: priv.larvis_todo_id || null,
    event_type: e.eventType ?? null,
    recurring_event_id: e.recurringEventId ?? null,
    place_id: priv.larvis_place_id || null,
  };
}

function toGoogleBody(input: Partial<EventInput>, colorHex?: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location;
  if (input.start) body.start = input.all_day ? { date: input.start } : { dateTime: input.start };
  if (input.end) body.end = input.all_day ? { date: input.end } : { dateTime: input.end };
  // Patch merges the private map per key (null deletes a key); only touch the keys
  // present in `input`, so an unspecified todo_id keeps existing todo linkage and
  // foreign private props stay intact.
  if (
    input.project_id !== undefined ||
    input.tags !== undefined ||
    input.todo_id !== undefined ||
    input.place_id !== undefined
  ) {
    const priv: Record<string, string | null> = {};
    if (input.project_id !== undefined) priv.larvis_project_id = input.project_id || null;
    if (input.tags !== undefined) priv.larvis_tags = input.tags.length ? input.tags.join(',') : null;
    if (input.place_id !== undefined) priv.larvis_place_id = input.place_id || null;
    if (input.todo_id !== undefined) {
      priv.larvis_todo_id = input.todo_id || null;
      priv.larvis_managed = input.todo_id ? 'todo' : null;
    }
    body.extendedProperties = { private: priv };
  }
  const colorId = hexToGoogleColorId(colorHex);
  if (colorId) body.colorId = colorId;
  return body;
}

async function listOne(token: string, cal: CalMeta, timeMin: string, timeMax: string) {
  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const json = (await api(token, `/calendars/${encodeURIComponent(cal.id)}/events?${params}`)) as {
    items?: GoogleEvent[];
  };
  return (json.items ?? []).map((e) => normalize(e, cal));
}

interface CalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string;
  selected?: boolean;
  deleted?: boolean;
}

/** Every calendar the user keeps visible in Google, plus the app calendar. */
async function visibleCalendars(token: string, larvisCalId: string): Promise<CalMeta[]> {
  const list = (await api(token, '/users/me/calendarList')) as { items?: CalendarListEntry[] };
  const cals: CalMeta[] = [];
  const seen = new Set<string>();
  for (const c of list.items ?? []) {
    if (c.deleted || c.selected === false) continue;
    cals.push({
      id: c.id,
      name: c.summaryOverride ?? c.summary ?? null,
      color: c.backgroundColor ?? null,
      editable: c.accessRole === 'owner' || c.accessRole === 'writer',
      source: c.id === larvisCalId ? 'larvis' : 'primary',
    });
    seen.add(c.id);
  }
  if (!seen.has(larvisCalId)) {
    cals.push({ id: larvisCalId, name: LARVIS_CALENDAR_NAME, color: null, editable: true, source: 'larvis' });
  }
  return cals;
}

// Internal calendar-id-scoped primitives (the public functions wrap them with auth).
async function createOn(token: string, calId: string, input: EventInput, colorHex?: string | null) {
  // Beim Anlegen gibt es keinen Schlüssel zu löschen: ein null im private-Map (kein
  // Projekt, keine Tags, kein Ort) weist Google bei insert mit 400 „Required“ ab.
  // Gleiche Regel wie toGoogleInsertBody in apps/web/api/_lib/google.ts.
  const body = toGoogleBody(input, colorHex);
  const ext = body.extendedProperties as { private: Record<string, string | null> } | undefined;
  if (ext) {
    for (const [k, v] of Object.entries(ext.private)) if (v === null) delete ext.private[k];
    if (!Object.keys(ext.private).length) delete body.extendedProperties;
  }
  const json = (await api(token, `/calendars/${encodeURIComponent(calId)}/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as GoogleEvent;
  return normalize(json, { id: calId, name: LARVIS_CALENDAR_NAME, color: null, editable: true, source: 'larvis' });
}
async function updateOn(token: string, calId: string, id: string, patch: Partial<EventInput>, colorHex?: string | null) {
  const json = (await api(token, `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(toGoogleBody(patch, colorHex)),
  })) as GoogleEvent;
  return normalize(json, { id: calId, name: LARVIS_CALENDAR_NAME, color: null, editable: true, source: 'larvis' });
}
async function deleteOn(token: string, calId: string, id: string) {
  await api(token, `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
/** Find an existing Larvis event mirroring a todo (idempotency guard against duplicates). */
async function findTodoEventId(token: string, calId: string, todoId: string): Promise<string | null> {
  const params = new URLSearchParams({ privateExtendedProperty: `larvis_todo_id=${todoId}`, maxResults: '1' });
  const json = (await api(token, `/calendars/${encodeURIComponent(calId)}/events?${params}`)) as { items?: { id: string }[] };
  return json.items?.[0]?.id ?? null;
}

/** List events from every visible calendar on the account, merged and sorted by start. */
export async function listEvents(timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  const { acct, token } = await auth();
  const larvisCalId = await ensureLarvisCalendar(acct, token);
  const cals = await visibleCalendars(token, larvisCalId);
  const batches = await Promise.all(cals.map((c) => listOne(token, c, timeMin, timeMax).catch(() => [] as CalendarEvent[])));
  return batches.flat().sort((a, b) => a.start.localeCompare(b.start));
}

export async function createEvent(input: EventInput): Promise<CalendarEvent> {
  const { acct, token } = await auth();
  const calId = await ensureLarvisCalendar(acct, token);
  return createOn(token, calId, input, await projectColor(input.project_id));
}

export async function updateEvent(id: string, patch: Partial<EventInput>): Promise<CalendarEvent> {
  const { acct, token } = await auth();
  const calId = await ensureLarvisCalendar(acct, token);
  return updateOn(token, calId, id, patch, await projectColor(patch.project_id));
}

/** Löscht einen Termin im Larvis-Kalender und gibt die id dieses Kalenders zurück. */
export async function deleteEvent(id: string): Promise<string> {
  const { acct, token } = await auth();
  const calId = await ensureLarvisCalendar(acct, token);
  await deleteOn(token, calId, id);
  return calId;
}

/** Einen Termin des Larvis-Kalenders lesen. */
export async function getEvent(id: string): Promise<CalendarEvent> {
  const { acct, token } = await auth();
  const calId = await ensureLarvisCalendar(acct, token);
  const json = (await api(token, `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`)) as GoogleEvent;
  return normalize(json, { id: calId, name: LARVIS_CALENDAR_NAME, color: null, editable: true, source: 'larvis' });
}

type TodoLike = Pick<Todo, 'id' | 'title' | 'due_at' | 'status' | 'project_id' | 'tags' | 'gcal_event_id'>;

/**
 * Reconcile a todo's mirror on the Larvis calendar. Creates/updates/deletes the
 * event to match the todo's due date + status, and persists gcal_event_id.
 * Idempotent (dedupes by larvis_todo_id) and best-effort: swallows errors so
 * todo writes never fail because of calendar issues.
 */
export async function syncTodoEvent(todo: TodoLike): Promise<void> {
  if (!googleConfigured()) return;
  try {
    const input = todoToEventInput(todo);
    const { acct, token } = await auth();
    const calId = await ensureLarvisCalendar(acct, token);

    if (!input) {
      const stale = todo.gcal_event_id ?? (await findTodoEventId(token, calId, todo.id));
      if (stale) {
        await deleteOn(token, calId, stale).catch(() => {});
        await db.from('todos').update({ gcal_event_id: null }).eq('id', todo.id);
      }
      return;
    }

    const color = await projectColor(todo.project_id);
    let eventId = todo.gcal_event_id ?? null;
    if (eventId) {
      try {
        await updateOn(token, calId, eventId, input, color);
        return;
      } catch {
        eventId = null; // vanished in Google -> fall through
      }
    }
    eventId = await findTodoEventId(token, calId, todo.id);
    if (eventId) {
      await updateOn(token, calId, eventId, input, color);
      if (eventId !== todo.gcal_event_id) await db.from('todos').update({ gcal_event_id: eventId }).eq('id', todo.id);
      return;
    }
    const ev = await createOn(token, calId, input, color);
    await db.from('todos').update({ gcal_event_id: ev.id }).eq('id', todo.id);
  } catch {
    /* calendar offline / not connected -> ignore */
  }
}

/** Remove a deleted todo's mirrored event. Best-effort. */
export async function deleteTodoEvent(eventId: string | null): Promise<void> {
  if (!eventId || !googleConfigured()) return;
  await deleteEvent(eventId).catch(() => {});
}
