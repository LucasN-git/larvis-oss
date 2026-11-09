import type { ApiRequest, ApiResponse } from '../_lib/types.js';
import type { CalendarEvent, CalendarSource, EventInput } from '@larvis/shared';
import { admin } from '../_lib/supabaseAdmin.js';
import { verifyOwner } from '../_lib/webAuth.js';
import { compareEventStart, isSubscriptionId, listSubscriptionEvents } from '../_lib/ics-bundle.js';
import {
  createEvent,
  deleteEvent,
  ensureAccessToken,
  ensureLarvisCalendar,
  getAccount,
  listEvents,
  projectColor,
  updateEvent,
} from '../_lib/google.js';

type Sb = ReturnType<typeof admin>;

/**
 * Two-way sync: when a todo-linked event on the Larvis calendar is edited
 * directly in the calendar, write the change back to the todo so the two never
 * drift apart. All-day events map back to a midnight-UTC due date (which the
 * todo→event mapper reads as "all day"); timed events keep their start time.
 */
async function syncEventToTodo(sb: Sb, ev: CalendarEvent): Promise<void> {
  if (!ev.todo_id) return;
  const title = ev.summary.replace(/^✓\s*/, '').trim() || 'Todo';
  const due_at = ev.all_day
    ? new Date(`${ev.start.slice(0, 10)}T00:00:00.000Z`).toISOString()
    : new Date(ev.start).toISOString();
  await sb
    .from('todos')
    .update({ title, due_at, project_id: ev.project_id, tags: ev.tags, gcal_event_id: ev.id })
    .eq('id', ev.todo_id);
}

const SUBSCRIPTION_READ_ONLY = 'Termine aus Kalender-Abos sind schreibgeschützt; ändern lassen sie sich nur in ihrem Ursprungskalender.';

/**
 * Kalender-Proxy. GET liefert die Termine aller sichtbaren Google-Kalender plus
 * Larvis-Kalender plus aller eingeschalteten Kalender-Abos (read-only ICS),
 * zusammengeführt und nach Beginn sortiert. Abos kommen auch ohne Google-Verbindung;
 * `connected` meint weiterhin nur Google. Ein fehlerhafter Kalender leert nie die
 * Liste, er steht dann in `errors`. POST/PATCH/DELETE schreiben nur nach Google
 * (Larvis-Kalender bzw. den Kalender des Termins) und weisen Abo-Termine ab.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  // Der Kalender enthält private und berufliche Termine: nur mit Owner-Sitzung.
  if (!(await verifyOwner(req))) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  try {
    const sb = admin();
    const body = (req.body ?? {}) as Partial<EventInput> & { id?: string; calendar_id?: string };

    if (req.method === 'GET') {
      const days = Math.min(Number(req.query.days) || 30, 365);
      const back = Math.min(Number(req.query.back) || 0, 365);
      const timeMin = new Date(Date.now() - back * 86400_000).toISOString();
      const timeMax = new Date(Date.now() + days * 86400_000).toISOString();

      const acct = await getAccount(sb);
      const connected = Boolean(acct?.refresh_token);
      const [google, subs] = await Promise.all([
        connected
          ? (async () => {
              const token = await ensureAccessToken(sb, acct!);
              const larvisCalId = await ensureLarvisCalendar(sb, acct!, token);
              return { events: await listEvents(token, larvisCalId, timeMin, timeMax), error: null as string | null };
            })().catch((e: unknown) => ({ events: [] as CalendarEvent[], error: e instanceof Error ? e.message : String(e) }))
          : Promise.resolve({ events: [] as CalendarEvent[], error: null as string | null }),
        listSubscriptionEvents(sb, timeMin, timeMax),
      ]);

      const errors = [
        ...(google.error ? [{ calendar: 'Google', error: google.error }] : []),
        ...subs.errors.map((e) => ({ calendar: e.name, error: e.error })),
        ...(subs.listError ? [{ calendar: 'Kalender-Abos', error: subs.listError }] : []),
      ];
      const events = [...google.events, ...subs.events].sort(compareEventStart);
      // Kein Zwischencache: ein Proxy-Cache würde nach POST/PATCH/DELETE noch
      // die alte Liste ausliefern, frisch angelegte Termine "verschwänden".
      // Client-seitig cached useCachedQuery bereits.
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json({
        connected,
        subscriptions: subs.subscriptions,
        events,
        ...(errors.length ? { errors } : {}),
      });
      return;
    }

    // Schreibwege: Abo-Termine nie, egal über welches Feld die id kommt.
    const targetIds = [body.id, body.calendar_id, req.query.id, req.query.calendar_id];
    if (targetIds.some((v) => typeof v === 'string' && isSubscriptionId(v))) {
      res.status(409).json({ error: SUBSCRIPTION_READ_ONLY });
      return;
    }

    const acct = await getAccount(sb);
    if (!acct?.refresh_token) {
      res.status(428).json({ error: 'Google Calendar not connected.' });
      return;
    }
    const token = await ensureAccessToken(sb, acct);
    const larvisCalId = await ensureLarvisCalendar(sb, acct, token);

    if (req.method === 'POST') {
      if (!body.summary || !body.start || !body.end) {
        res.status(400).json({ error: 'summary, start and end are required.' });
        return;
      }
      // Real Google birthdays must live on the primary calendar — that's where
      // Google renders the cake + annual recurrence. Everything else → Larvis.
      const ev = body.birthday
        ? await createEvent(token, 'primary', body as EventInput, null, 'primary')
        : await createEvent(token, larvisCalId, body as EventInput, await projectColor(sb, body.project_id));
      res.status(200).json({ event: ev });
      return;
    }

    if (req.method === 'PATCH') {
      if (!body.id) {
        res.status(400).json({ error: 'id is required.' });
        return;
      }
      const { id, calendar_id, ...patch } = body;
      // Route the edit to the calendar the event actually lives on (defaults to Larvis).
      const calId = calendar_id || larvisCalId;
      const source: CalendarSource = calId === larvisCalId ? 'larvis' : 'primary';
      const ev = await updateEvent(token, calId, id, patch, await projectColor(sb, patch.project_id), source);
      // Keep a mirrored todo in step when its event is edited on the Larvis calendar.
      if (source === 'larvis' && ev.todo_id) await syncEventToTodo(sb, ev);
      res.status(200).json({ event: ev });
      return;
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id as string) || body.id;
      if (!id) {
        res.status(400).json({ error: 'id is required.' });
        return;
      }
      const calId = (req.query.calendar_id as string) || body.calendar_id || larvisCalId;
      const todoId = (req.query.todo_id as string) || null;
      await deleteEvent(token, calId, id);
      // Detach a deleted event from its todo so no stale gcal_event_id lingers.
      if (todoId) await sb.from('todos').update({ gcal_event_id: null }).eq('id', todoId);
      res.status(200).json({ deleted: id });
      return;
    }

    res.status(405).json({ error: 'Method not allowed.' });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e), events: [] });
  }
}
