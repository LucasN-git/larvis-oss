import type { CalendarEvent, CalendarSubscription, EventInput, Todo } from '@larvis/shared';
import { supabase } from './supabase';

export interface CalendarResponse {
  /** Google-Konto verbunden. */
  connected: boolean;
  /** Anzahl eingeschalteter Kalender-Abos; deren Termine kommen auch ohne Google. */
  subscriptions: number;
  events: CalendarEvent[];
  /** Kalender, die gerade nicht gelesen werden konnten (die übrigen Termine kommen trotzdem). */
  errors: { calendar: string; error: string }[];
}

/** Header mit dem Owner-Bearer der laufenden Sitzung; die Kalender-Endpoints verlangen ihn. */
async function authHeaders(json = false): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Termine aller Kalender (Google + Larvis + Kalender-Abos), zusammengeführt. */
export async function fetchEvents(opts: { days?: number; back?: number } = {}): Promise<CalendarResponse> {
  const { days = 30, back = 0 } = opts;
  const res = await fetch(`/api/calendar/events?days=${days}&back=${back}`, { headers: await authHeaders() });
  if (res.status === 404 || res.status === 428) return { connected: false, subscriptions: 0, events: [], errors: [] };
  if (!res.ok) throw new Error(`Kalender-Fehler ${res.status}`);
  const json = (await res.json()) as Partial<CalendarResponse>;
  return {
    connected: json.connected ?? true,
    subscriptions: json.subscriptions ?? 0,
    events: json.events ?? [],
    errors: json.errors ?? [],
  };
}

/** Back-compat shim for the dashboard agenda card. */
export async function fetchUpcomingEvents(days = 7): Promise<CalendarResponse> {
  return fetchEvents({ days });
}

export async function startGoogleConnect() {
  const res = await fetch('/api/google/oauth-start', { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Google-Verbindung fehlgeschlagen (${res.status})`);
  window.location.href = ((await res.json()) as { url: string }).url;
}

export async function createEvent(input: EventInput): Promise<CalendarEvent> {
  const res = await fetch('/api/calendar/events', { method: 'POST', headers: await authHeaders(true), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(`Anlegen fehlgeschlagen (${res.status})`);
  return ((await res.json()) as { event: CalendarEvent }).event;
}

export async function updateEvent(
  id: string,
  patch: Partial<EventInput>,
  calendarId?: string,
): Promise<CalendarEvent> {
  const res = await fetch('/api/calendar/events', {
    method: 'PATCH',
    headers: await authHeaders(true),
    body: JSON.stringify({ id, calendar_id: calendarId, ...patch }),
  });
  if (!res.ok) throw new Error(`Speichern fehlgeschlagen (${res.status})`);
  return ((await res.json()) as { event: CalendarEvent }).event;
}

export async function deleteEvent(
  id: string,
  opts: { calendarId?: string; todoId?: string | null } = {},
): Promise<void> {
  const params = new URLSearchParams({ id });
  if (opts.calendarId) params.set('calendar_id', opts.calendarId);
  if (opts.todoId) params.set('todo_id', opts.todoId);
  const res = await fetch(`/api/calendar/events?${params}`, { method: 'DELETE', headers: await authHeaders() });
  if (!res.ok) throw new Error(`Löschen fehlgeschlagen (${res.status})`);
}

type TodoSync = Pick<Todo, 'id' | 'title' | 'due_at' | 'status' | 'project_id' | 'tags' | 'gcal_event_id'>;

/** Mirror a todo into the Larvis calendar (fire-and-forget; never throws). */
export async function syncTodoToCalendar(todo: TodoSync): Promise<void> {
  try {
    await fetch('/api/calendar/sync-todo', { method: 'POST', headers: await authHeaders(true), body: JSON.stringify({ todo }) });
  } catch {
    /* calendar sync is best-effort */
  }
}

/** Remove a deleted todo's mirrored event (fire-and-forget; never throws). */
export async function removeTodoEvent(eventId: string): Promise<void> {
  try {
    await fetch('/api/calendar/sync-todo', {
      method: 'POST',
      headers: await authHeaders(true),
      body: JSON.stringify({ delete_event_id: eventId }),
    });
  } catch {
    /* best-effort */
  }
}

// --- Kalender-Abos (read-only ICS) -----------------------------------------------

async function subscriptionRequest<T>(method: string, body?: unknown, query = ''): Promise<T> {
  const res = await fetch(`/api/calendar/subscriptions${query}`, {
    method,
    headers: await authHeaders(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `Kalender-Abos: Fehler ${res.status}`);
  return json;
}

export async function listSubscriptions(): Promise<CalendarSubscription[]> {
  return (await subscriptionRequest<{ subscriptions: CalendarSubscription[] }>('GET')).subscriptions;
}

/** Legt ein Abo an; der Server liest den Link vorher einmal und wirft mit deutscher Meldung, wenn dort kein Kalender liegt. */
export async function addSubscription(input: {
  url: string;
  name?: string;
  color?: string;
  project_id?: string | null;
}): Promise<CalendarSubscription> {
  return (await subscriptionRequest<{ subscription: CalendarSubscription }>('POST', input)).subscription;
}

export async function updateSubscription(
  id: string,
  patch: Partial<Pick<CalendarSubscription, 'name' | 'color' | 'enabled' | 'project_id'>> & { url?: string },
): Promise<CalendarSubscription> {
  return (await subscriptionRequest<{ subscription: CalendarSubscription }>('PATCH', { id, ...patch })).subscription;
}

export async function deleteSubscription(id: string): Promise<void> {
  await subscriptionRequest('DELETE', undefined, `?id=${encodeURIComponent(id)}`);
}
