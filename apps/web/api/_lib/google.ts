import type { ApiRequest } from './types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarEvent, CalendarSource, Database, EventInput } from '@larvis/shared';
import { hexToGoogleColorId } from './calendar.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';
// Full calendar scope: needed to create + manage the secondary "Larvis" calendar.
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const LARVIS_CALENDAR_NAME = 'Larvis';
const CAL_TIMEZONE = 'Europe/Berlin';

type Sb = SupabaseClient<Database>;
type Account = Database['public']['Tables']['calendar_accounts']['Row'];

export function getRedirectUri(req: ApiRequest): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/google/oauth-callback`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

/** Return a valid access token, refreshing + persisting if expired. */
export async function ensureAccessToken(sb: Sb, acct: Account): Promise<string> {
  const valid = acct.access_token && acct.expiry && new Date(acct.expiry).getTime() - 60_000 > Date.now();
  if (valid) return acct.access_token!;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: acct.refresh_token!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const json = (await res.json()) as TokenResponse;
  await sb
    .from('calendar_accounts')
    .update({ access_token: json.access_token, expiry: new Date(Date.now() + json.expires_in * 1000).toISOString() })
    .eq('id', acct.id);
  return json.access_token;
}

/** Fetch the connected Google account row (or null if not connected). */
export async function getAccount(sb: Sb): Promise<Account | null> {
  const { data } = await sb.from('calendar_accounts').select('*').eq('provider', 'google').maybeSingle();
  return (data as Account) ?? null;
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

/** Resolve (and lazily create) the app-managed "Larvis" calendar; cache its id on the account. */
export async function ensureLarvisCalendar(sb: Sb, acct: Account, token: string): Promise<string> {
  if (acct.larvis_calendar_id) return acct.larvis_calendar_id;

  // Reuse an existing calendar with our name before creating a new one.
  const list = (await api(token, '/users/me/calendarList')) as { items?: { id: string; summary?: string }[] };
  let id = list.items?.find((c) => c.summary === LARVIS_CALENDAR_NAME)?.id;

  if (!id) {
    const created = (await api(token, '/calendars', {
      method: 'POST',
      body: JSON.stringify({ summary: LARVIS_CALENDAR_NAME, timeZone: CAL_TIMEZONE }),
    })) as { id: string };
    id = created.id;
  }

  await sb.from('calendar_accounts').update({ larvis_calendar_id: id }).eq('id', acct.id);
  return id;
}

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

/** Obergrenze gegen eine endlose Schleife: 10 Seiten sind 2500 Termine je Kalender. */
const MAX_EVENT_PAGES = 10;

async function listOne(token: string, cal: CalMeta, timeMin: string, timeMax: string) {
  // Google liefert höchstens 250 Termine je Seite. Ein langes Fenster (die Geburtstagsansicht
  // fragt ein ganzes Jahr ab) braucht deshalb alle Seiten, sonst fehlt still das Jahresende.
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    if (pageToken) params.set('pageToken', pageToken);
    const json = (await api(token, `/calendars/${encodeURIComponent(cal.id)}/events?${params}`)) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };
    items.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return items.map((e) => normalize(e, cal));
}

interface CalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string; // owner | writer | reader | freeBusyReader
  selected?: boolean;
  deleted?: boolean;
}

/** Which of the account's calendars to read: every calendar the user keeps visible in Google. */
async function visibleCalendars(token: string, larvisCalId: string): Promise<CalMeta[]> {
  const list = (await api(token, '/users/me/calendarList')) as { items?: CalendarListEntry[] };
  const cals: CalMeta[] = [];
  const seen = new Set<string>();
  for (const c of list.items ?? []) {
    if (c.deleted || c.selected === false) continue; // respect the user's Google visibility choices
    cals.push({
      id: c.id,
      name: c.summaryOverride ?? c.summary ?? null,
      color: c.backgroundColor ?? null,
      editable: c.accessRole === 'owner' || c.accessRole === 'writer',
      source: c.id === larvisCalId ? 'larvis' : 'primary',
    });
    seen.add(c.id);
  }
  // Always include the app calendar, even if the user has hidden it in Google.
  if (!seen.has(larvisCalId)) {
    cals.push({ id: larvisCalId, name: LARVIS_CALENDAR_NAME, color: null, editable: true, source: 'larvis' });
  }
  return cals;
}

/** List events from every visible calendar on the account, merged + sorted by start. */
export async function listEvents(
  token: string,
  larvisCalId: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const cals = await visibleCalendars(token, larvisCalId);
  // One slow/broken calendar shouldn't blank the whole list.
  const batches = await Promise.all(cals.map((c) => listOne(token, c, timeMin, timeMax).catch(() => [] as CalendarEvent[])));
  return batches.flat().sort((a, b) => a.start.localeCompare(b.start));
}

const DAY_MS = 86_400_000;

/** Annual recurrence for a birthday on `date` (Feb 29 clamps to the last of Feb). */
function birthdayRecurrence(date: string): string[] {
  const [, m, d] = date.split('-').map(Number);
  if (m === 2 && d === 29) return ['RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1'];
  return ['RRULE:FREQ=YEARLY'];
}

/**
 * Build a real Google birthday: all-day, yearly-recurring, on the primary
 * calendar. Google forbids any other properties on birthday events, so this
 * carries only summary + dates + the required recurrence/visibility flags.
 */
function toBirthdayBody(input: Partial<EventInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    eventType: 'birthday',
    transparency: 'transparent',
    visibility: 'private',
    birthdayProperties: { type: 'birthday' },
  };
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.start) {
    const end = input.end || new Date(new Date(`${input.start}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);
    body.start = { date: input.start };
    body.end = { date: end };
    body.recurrence = birthdayRecurrence(input.start);
  }
  return body;
}

function toGoogleBody(input: Partial<EventInput>, colorHex?: string | null): Record<string, unknown> {
  if (input.birthday) return toBirthdayBody(input);
  const body: Record<string, unknown> = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location;
  if (input.start) body.start = input.all_day ? { date: input.start } : { dateTime: input.start };
  if (input.end) body.end = input.all_day ? { date: input.end } : { dateTime: input.end };

  // Project / tags / todo / place linkage round-trips through private extendedProperties.
  // Patch merges the private map per key (null deletes a key), so we only touch
  // the keys present in `input` — other apps' private props are left intact, and
  // an unspecified todo_id keeps an event's existing todo linkage.
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

/**
 * Body für ein neues Event. Beim Anlegen gibt es keinen Schlüssel zu löschen: ein
 * null im private-Map (kein Projekt, keine Tags, kein Ort) weist Google bei insert
 * mit 400 „Required“ ab, deshalb fallen diese Schlüssel hier weg.
 */
export function toGoogleInsertBody(input: Partial<EventInput>, colorHex?: string | null): Record<string, unknown> {
  const body = toGoogleBody(input, colorHex);
  const ext = body.extendedProperties as { private: Record<string, string | null> } | undefined;
  if (ext) {
    for (const [k, v] of Object.entries(ext.private)) if (v === null) delete ext.private[k];
    if (!Object.keys(ext.private).length) delete body.extendedProperties;
  }
  return body;
}

// The response is re-fetched right after a write, so its calendar metadata need
// only be truthful about source + id; name/colour are filled by the next listEvents.
function writeMeta(calendarId: string, source: CalendarSource): CalMeta {
  return { id: calendarId, name: null, color: null, editable: true, source };
}

export async function createEvent(
  token: string,
  calendarId: string,
  input: EventInput,
  colorHex?: string | null,
  source: CalendarSource = 'larvis',
): Promise<CalendarEvent> {
  const json = (await api(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(toGoogleInsertBody(input, colorHex)),
  })) as GoogleEvent;
  return normalize(json, writeMeta(calendarId, source));
}

export async function updateEvent(
  token: string,
  calendarId: string,
  id: string,
  patch: Partial<EventInput>,
  colorHex?: string | null,
  source: CalendarSource = 'larvis',
): Promise<CalendarEvent> {
  const json = (await api(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(toGoogleBody(patch, colorHex)),
  })) as GoogleEvent;
  return normalize(json, writeMeta(calendarId, source));
}

export async function deleteEvent(token: string, calendarId: string, id: string): Promise<void> {
  await api(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Find an existing Larvis event mirroring a todo (idempotency guard against duplicates). */
export async function findEventByTodo(token: string, calendarId: string, todoId: string): Promise<string | null> {
  const params = new URLSearchParams({ privateExtendedProperty: `larvis_todo_id=${todoId}`, maxResults: '1' });
  const json = (await api(token, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`)) as {
    items?: { id: string }[];
  };
  return json.items?.[0]?.id ?? null;
}

type ColorProject = { id: string; parent_id: string | null; color: string | null };

/**
 * Wirksame Farbe eines Projekts: ein Unterprojekt ohne eigene Farbe erbt die
 * seines Elternprojekts (rekursiv, höchstens 16 Ebenen, Zyklen brechen ab).
 * Kopie von packages/shared/src/projects.ts effectiveProjectColor — synchron halten.
 */
export function effectiveProjectColor(projects: readonly ColorProject[], id: string | null | undefined): string | null {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const visited = new Set<string>();
  let cur = id ? byId.get(id) : undefined;
  for (let depth = 0; cur && depth < 16; depth++) {
    if (cur.color) return cur.color;
    if (visited.has(cur.id)) return null;
    visited.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return null;
}

/** Wirksame (vererbte) Farbe eines Projekts für die Google-Farbzuordnung, oder null. */
export async function projectColor(sb: Sb, projectId: string | null | undefined): Promise<string | null> {
  if (!projectId) return null;
  const { data } = await sb.from('projects').select('id, parent_id, color').is('deleted_at', null);
  return effectiveProjectColor(data ?? [], projectId);
}
