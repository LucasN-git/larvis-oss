import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { compareEventStart, planEventReminder, type CalendarEvent, type ReminderPlan } from '@larvis/shared';
import { isSubscriptionId, listCalendarSubscriptions, listSubscriptionEvents } from '@larvis/shared/ics';
import { createEvent, deleteEvent, getEvent, listEvents, updateEvent } from '../google.js';
import {
  applyEventReminder,
  deleteEventReminder,
  readEventReminder,
  shiftEventReminder,
} from '../reminders.js';
import { db } from '../supabase.js';
import { fail, guard, ok } from '../util.js';

const SUBSCRIPTION_READ_ONLY =
  'This event comes from a read-only calendar subscription (Kalender-Abo, ICS link). Larvis never writes to it; change it in its source calendar (e.g. Outlook).';

const REMINDER_DOC =
  ' Erinnerung: Standard: Vorlauf des Themas Termine (ab Werk 30 Minuten), ganztägig keine. reminder_minutes setzt einen eigenen Vorlauf in Minuten, reminder_minutes: null schaltet die Erinnerung aus, reminder_at setzt den Zeitpunkt exakt (ISO); nur eins von beiden angeben. Ohne beides bleibt die Erinnerung, wie sie ist. place_id verknüpft den Termin mit einem Ort aus Larvis (null löst ihn). Die Antwort trägt reminder: {mode: default|custom|off, notify_at}.';

const extraInputs = {
  place_id: z.string().nullable().optional(),
  reminder_minutes: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe('Minuten vor Beginn; null = Erinnerung aus. Standard: Vorlauf des Themas Termine (ab Werk 30 Minuten), ganztägig keine.'),
  reminder_at: z.string().optional().describe('Exakter Erinnerungszeitpunkt (ISO). Nicht zusammen mit reminder_minutes.'),
};

type ReminderArgs = { reminder_minutes?: number | null; reminder_at?: string };

/** Erinnerung planen; wirft bei ungültigen Angaben (vor jedem Schreibzugriff aufrufen). */
function plan(start: string, allDay: boolean | undefined, r: ReminderArgs): ReminderPlan {
  return planEventReminder({ start, all_day: allDay, reminder_minutes: r.reminder_minutes, reminder_at: r.reminder_at }, Date.now());
}

function hasReminderInput(r: ReminderArgs): boolean {
  return r.reminder_minutes !== undefined || r.reminder_at !== undefined;
}

/** Beginn eines Termins für start_at: ISO-Zeitpunkt, ganztägig das blanke Datum wie im Web-Editor. */
function startInstant(ev: CalendarEvent): string {
  return ev.all_day ? ev.start.slice(0, 10) : new Date(ev.start).toISOString();
}

async function withReminder(ev: CalendarEvent) {
  return { ...ev, reminder: await readEventReminder(db, { eventId: ev.id, calendarId: ev.calendar_id }) };
}

export function registerCalendarTools(server: McpServer) {
  server.registerTool(
    'list_calendar_events',
    {
      title: 'List calendar events',
      description:
        'List calendar events, merged and sorted by start: every Google calendar the user keeps visible (primary, secondary and the app-managed "Larvis" calendar) plus every enabled read-only calendar subscription ("Kalender-Abo": an ICS link, e.g. Outlook or the work Google calendar). Defaults to the next 7 days; or pass explicit ISO time_min/time_max. Each event carries calendar ("primary"|"larvis"|"subscription"), calendar_id, calendar_name, editable, project_id, tags and todo_id. Subscription events have calendar="subscription", calendar_id "sub:<id>", editable=false and can never be changed through Larvis; they carry the project_id of their subscription (null if the subscription has no project). Returns an array of events; if a calendar could not be read, returns { events, errors } instead.',
      inputSchema: {
        days: z.number().optional(),
        time_min: z.string().optional(),
        time_max: z.string().optional(),
      },
    },
    async ({ days = 7, time_min, time_max }) =>
      guard(async () => {
        const min = time_min ?? new Date().toISOString();
        const max = time_max ?? new Date(Date.now() + days * 86400_000).toISOString();
        const [google, subs] = await Promise.all([
          // Wirft selbst, wenn Google nicht eingerichtet oder nicht verbunden ist.
          listEvents(min, max).then(
            (events) => ({ events, error: null as string | null }),
            (e: unknown) => ({ events: [] as CalendarEvent[], error: e instanceof Error ? e.message : String(e) }),
          ),
          listSubscriptionEvents(db, min, max),
        ]);
        const events = [...google.events, ...subs.events].sort(compareEventStart);
        const errors = [
          ...(google.error ? [{ calendar: 'Google', error: google.error }] : []),
          ...subs.errors.map((e) => ({ calendar: e.name, error: e.error })),
          ...(subs.listError ? [{ calendar: 'Kalender-Abos', error: subs.listError }] : []),
        ];
        // Ohne eingeschaltete Abos bleibt ein Google-Fehler der Fehler des Tools, wie vor den Abos.
        if (google.error && !subs.subscriptions && !subs.listError) throw new Error(google.error);
        return ok(errors.length ? { events, errors } : events);
      }),
  );

  server.registerTool(
    'list_calendar_subscriptions',
    {
      title: 'List calendar subscriptions',
      description:
        'List the read-only calendar subscriptions ("Kalender-Abos"): foreign calendars Larvis reads via a secret ICS link (e.g. Outlook, the work Google calendar). Returns id, name, color, project_id, project ({ id, name } or null), enabled, url_hint (host + masked tail; the secret link itself is never returned), last_synced_at and last_error. A subscription with a project hands that project_id to all its events, which are then shown in the (inherited) project colour; color is the subscription\'s own colour, used only without a project. Read-only: subscriptions are added, renamed, assigned to a project and removed by the user in the web app (Kalender → Kalender-Abos).',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const subs = await listCalendarSubscriptions(db);
        const ids = [...new Set(subs.flatMap((s) => (s.project_id ? [s.project_id] : [])))];
        const names = new Map<string, string>();
        if (ids.length) {
          const { data, error } = await db.from('projects').select('id, name').in('id', ids);
          if (error) throw new Error(error.message);
          for (const p of data ?? []) names.set(p.id, p.name);
        }
        return ok(
          subs.map((s) => ({
            ...s,
            project: s.project_id ? { id: s.project_id, name: names.get(s.project_id) ?? null } : null,
          })),
        );
      }),
  );

  server.registerTool(
    'create_calendar_event',
    {
      title: 'Create calendar event',
      description:
        'Create an event on the Larvis calendar. Use ISO datetimes; set all_day=true with YYYY-MM-DD dates (end is exclusive). Optionally tie it to a project (project_id) and tags; the event is coloured by the (inherited) project colour.' +
        REMINDER_DOC,
      inputSchema: {
        summary: z.string(),
        start: z.string(),
        end: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
        all_day: z.boolean().optional(),
        project_id: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        ...extraInputs,
      },
    },
    async ({ reminder_minutes, reminder_at, ...input }) =>
      guard(async () => {
        const r = { reminder_minutes, reminder_at };
        let p: ReminderPlan;
        try {
          p = plan(input.start, input.all_day, r);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
        const ev = await createEvent(input);
        await applyEventReminder(db, { eventId: ev.id, calendarId: ev.calendar_id, title: ev.summary, plan: p });
        return ok(await withReminder(ev));
      }),
  );

  server.registerTool(
    'update_calendar_event',
    {
      title: 'Update calendar event',
      description:
        'Patch fields of an existing Larvis calendar event by id (incl. project_id, tags and place_id). Events from calendar subscriptions (calendar_id "sub:…") are read-only and rejected. Wird der Beginn verschoben, wandert eine eigene Erinnerung mit (gleicher Vorlauf).' +
        REMINDER_DOC,
      inputSchema: {
        id: z.string(),
        summary: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        all_day: z.boolean().optional(),
        project_id: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        ...extraInputs,
      },
    },
    async ({ id, reminder_minutes, reminder_at, ...patch }) =>
      isSubscriptionId(id)
        ? fail(SUBSCRIPTION_READ_ONLY)
        : guard(async () => {
            const r = { reminder_minutes, reminder_at };
            let p: ReminderPlan = { action: 'keep' };
            if (hasReminderInput(r)) {
              // Ohne neuen Beginn rechnet der Vorlauf vom bestehenden Beginn aus.
              const current = patch.start ? null : await getEvent(id);
              const start = patch.start ?? current!.start;
              const allDay = patch.all_day ?? (patch.start ? undefined : current!.all_day);
              try {
                p = plan(start, allDay, r);
              } catch (e) {
                return fail(e instanceof Error ? e.message : String(e));
              }
            }
            const ev = await updateEvent(id, patch);
            const ref = { eventId: ev.id, calendarId: ev.calendar_id };
            if (p.action !== 'keep') {
              await applyEventReminder(db, { ...ref, title: ev.summary, plan: p });
            } else if (patch.start !== undefined || patch.summary !== undefined) {
              await shiftEventReminder(db, { ...ref, newStartAt: startInstant(ev), title: ev.summary });
            }
            return ok(await withReminder(ev));
          }),
  );

  server.registerTool(
    'delete_calendar_event',
    {
      title: 'Delete calendar event',
      description: 'Delete an event from the Larvis calendar by id.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      isSubscriptionId(id)
        ? fail(SUBSCRIPTION_READ_ONLY)
        : guard(async () => {
            const calendarId = await deleteEvent(id);
            await deleteEventReminder(db, { eventId: id, calendarId });
            return ok({ deleted: id });
          }),
  );
}
