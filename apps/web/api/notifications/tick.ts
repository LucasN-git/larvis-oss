import type { ApiRequest, ApiResponse } from '../_lib/types.js';
import type { CalendarEvent, Database } from '@larvis/shared';
import { admin } from '../_lib/supabaseAdmin.js';
import { ensureAccessToken, ensureLarvisCalendar, getAccount, listEvents } from '../_lib/google.js';
import { isSubscriptionId, listSubscriptionEvents, lookupSubscriptionEvent } from '../_lib/ics-bundle.js';
import {
  CalendarUnreadableError,
  loadCalendarWindow,
  tickErrors,
  type CalendarSourceError,
  type CalendarWindow,
} from '../_lib/calendarWindow.js';
import { configureVapid, makeSender, type PushPayload } from '../_lib/pushSender.js';
import {
  DAILY_GRACE_MS,
  LEAD_GRACE_MS,
  addDaysYMD,
  berlinDate,
  berlinWallTime,
  birthdayHeadline,
  isAllDayDue,
  isDue,
  isLeadNotifiable,
  reminderAppliesTo,
  normalizePrefs,
  notificationKey,
  type NotificationCategory,
  type NotificationPrefs,
} from '../_lib/notificationPrefs.js';
import {
  berlinDayWindow,
  birthdayPeople,
  birthdayPeopleText,
  birthdayWindow,
  digestBody,
  dueLeads,
  eventBody,
  eventsOnDay,
  googleBirthdaysOn,
  leadWindow,
  learnwebBody,
  reminderEventBody,
  reminderTodoBody,
  todoLeadBody,
  todosDayBody,
  type BirthdayContact,
  type BirthdayPerson,
  type TimeWindow,
} from '../_lib/notificationContent.js';

// Minuten-Cron-Endpoint: pg_cron (Job larvis-reminders) ruft ihn jede Minute mit
// dem Vault-Secret als Bearer und verschickt fällige Benachrichtigungen per Web
// Push an alle abonnierten Geräte. Quellen, in dieser Reihenfolge:
//   reminders  eigene Zeiten für einen Termin oder ein ToDo — gelten auch bei
//              abgeschaltetem Thema; an Abo-Terminen nur, solange der Termin im Feed
//              noch zu dieser Zeit steht
//   events     Termine mit Uhrzeit aus Google und Kalender-Abos, Vorlauf aus
//              notification_settings
//   todos      ToDos mit Uhrzeit (Vorlauf) und ganztägige gesammelt zur Tageszeit
//   birthdays  Kontakte und Google-Geburtstage, am Tag und/oder Tage vorher
//              (Abos tragen keine Geburtstage bei)
//   learnweb   Abgaben mit einem oder mehreren Vorläufen
//   digest     Tagesüberblick
// Ein Ziel mit reminders-Zeile (eigene Zeit oder „Aus") bekommt keine
// Themen-Nachricht. Jede Themen-Nachricht claimt vor dem Senden ihren
// Anlass-Schlüssel in notification_log (Primärschlüssel = atomarer Schutz gegen
// parallele Ticks); eigene Erinnerungen claimen über reminders.sent_at. Jede
// Quelle läuft für sich: ein Fehler landet in errors, die übrigen laufen weiter.

type Sb = ReturnType<typeof admin>;
type ReminderRow = Database['public']['Tables']['reminders']['Row'];
type SentCategory = NotificationCategory | 'reminder';
type Step = SentCategory | 'prune';

const MIN = 60_000;
const DAY_MS = 86_400_000;
/** Eigene Erinnerungen, deren Zeit länger her ist, werden still verworfen statt verspätet zu feuern. */
const REMINDER_STALE_MS = 60 * MIN;
/** Protokollzeilen älter als das werden gelöscht — einmal pro Stunde, in dieser UTC-Minute. */
const LOG_RETENTION_MS = 90 * DAY_MS;
const PRUNE_MINUTE = 17;
/** PostgREST liefert höchstens so viele Zeilen je Abfrage; Kontakte werden seitenweise gelesen. */
const PAGE = 1000;

interface Tick {
  sb: Sb;
  now: number;
  /** Heutiger Berliner Kalendertag (YYYY-MM-DD). */
  today: string;
  prefs: NotificationPrefs;
  sender: ReturnType<typeof makeSender>;
  calendar: CalendarAccess;
  /**
   * Kalenderfenster ab heute für Geburtstage und Tagesüberblick: bei
   * eingeschalteten Geburtstagen bis zum spätesten Zieltag, sonst nur heute.
   * Beide teilen sich so einen Abruf je Tick.
   */
  calendarDays: TimeWindow;
  birthdaysOn: (ymd: string) => Promise<BirthdayLookup>;
  sent: Record<SentCategory, number>;
  errors: Partial<Record<Step, string>>;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function noteError(t: Tick, step: Step, e: unknown) {
  const msg = errorText(e);
  t.errors[step] = t.errors[step] ? `${t.errors[step]}; ${msg}` : msg;
}

// ---------------------------------------------------------------------------
// Versandprotokoll
// ---------------------------------------------------------------------------

async function isLogged(sb: Sb, key: string): Promise<boolean> {
  const { data, error } = await sb.from('notification_log').select('key').eq('key', key).maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/**
 * Claim → senden → hat kein Gerät die Nachricht angenommen, Claim wieder
 * löschen, damit der nächste Tick im Kulanzfenster erneut versucht. Konflikt
 * beim Claim (23505) heißt: ein anderer Tick hat den Anlass schon. Waren alle
 * Abos erloschen, sind sie schon gelöscht: der nächste Tick endet bei „keine
 * Abos", und ein neues Abo im Kulanzfenster bekommt die Nachricht noch.
 */
async function deliver(t: Tick, category: NotificationCategory, key: string, payload: PushPayload): Promise<void> {
  if (!t.sender.hasSubscribers()) return;
  const { error } = await t.sb
    .from('notification_log')
    .insert({ key, category, title: payload.title, body: payload.body });
  if (error) {
    if (error.code === '23505') return;
    throw new Error(error.message);
  }
  const result = await t.sender.send(payload);
  if (result.error) noteError(t, category, result.error);
  if (result.anyDelivered) {
    t.sent[category]++;
    return;
  }
  const { error: releaseError } = await t.sb.from('notification_log').delete().eq('key', key);
  if (releaseError) noteError(t, category, `Claim ${key} nicht freigegeben: ${releaseError.message}`);
}

// ---------------------------------------------------------------------------
// Quellen, je Tick einmal geladen
// ---------------------------------------------------------------------------

/** Google-Termine eines Fensters; null = Google nicht verbunden. Wirft, wenn Google nicht lesbar ist. */
type GoogleAccess = (window: TimeWindow) => Promise<CalendarEvent[] | null>;

/**
 * Termine eines Fensters aus allen sichtbaren Google-Kalendern und allen eingeschalteten
 * Kalender-Abos (siehe loadCalendarWindow). null = weder Google verbunden noch ein Abo
 * eingeschaltet; wirft nur, wenn keine Quelle lesbar war. Teilausfälle stehen in errors.
 */
type CalendarAccess = (window: TimeWindow) => Promise<CalendarWindow | null>;

/** Konto, Token und Larvis-Kalender erst beim ersten Bedarf und nur einmal; jede Liste je Fenster einmal. */
function googleAccess(sb: Sb): GoogleAccess {
  let session: Promise<{ token: string; larvisCalId: string } | null> | null = null;
  const lists = new Map<string, Promise<CalendarEvent[] | null>>();
  return (window) => {
    const key = `${window.from}|${window.to}`;
    let list = lists.get(key);
    if (!list) {
      list = (async () => {
        session ??= (async () => {
          const acct = await getAccount(sb);
          if (!acct?.refresh_token) return null;
          const token = await ensureAccessToken(sb, acct);
          return { token, larvisCalId: await ensureLarvisCalendar(sb, acct, token) };
        })();
        const s = await session;
        return s ? listEvents(s.token, s.larvisCalId, window.from, window.to) : null;
      })();
      lists.set(key, list);
    }
    return list;
  };
}

/** Google plus Abos, jede zusammengeführte Liste je Fenster einmal. */
function calendarAccess(sb: Sb, google: GoogleAccess): CalendarAccess {
  const lists = new Map<string, Promise<CalendarWindow | null>>();
  return (window) => {
    const key = `${window.from}|${window.to}`;
    let list = lists.get(key);
    if (!list) {
      list = loadCalendarWindow({
        google: () => google(window),
        subscriptions: () => listSubscriptionEvents(sb, window.from, window.to),
      });
      lists.set(key, list);
    }
    return list;
  };
}

/** Kalenderfehler unter dem Schritt festhalten, der gelesen hat — ohne einzelne kaputte Abos. */
function noteCalendarErrors(t: Tick, step: Step, errors: CalendarSourceError[]) {
  for (const e of tickErrors(errors)) noteError(t, step, `Kalender: ${e.message}`);
}

interface BirthdayLookup {
  people: BirthdayPerson[];
  /** Kalender nicht lesbar — die Kontakt-Geburtstage stehen trotzdem in people. */
  calendarError: string | null;
}

async function loadBirthdayContacts(sb: Sb): Promise<BirthdayContact[]> {
  const rows: BirthdayContact[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('contacts')
      .select('first_name,last_name,nickname,birthday,birthday_year_known')
      .is('deleted_at', null)
      .not('birthday', 'is', null)
      .order('first_name')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/**
 * Geburtstage je Tag, gemeinsam für Geburtstags-Nachrichten und Tagesüberblick.
 * Google-Geburtstage kommen aus einem Google-Fenster über alle Zieltage und
 * werden je Tag daraus gefiltert — ein Abruf je Tick, auch wenn niemand Geburtstag hat.
 */
function birthdaySource(
  sb: Sb,
  google: GoogleAccess,
  window: TimeWindow,
): (ymd: string) => Promise<BirthdayLookup> {
  let contacts: Promise<BirthdayContact[]> | null = null;

  async function lookup(ymd: string): Promise<BirthdayLookup> {
    contacts ??= loadBirthdayContacts(sb);
    const list = await contacts;
    let googleNames: string[] = [];
    let calendarError: string | null = null;
    try {
      // Geburtstage kommen nur aus Google; Abos tragen keine bei.
      const events = await google(window);
      if (events) googleNames = googleBirthdaysOn(events, ymd);
    } catch (e) {
      calendarError = `Kalender: ${errorText(e)}`;
    }
    return { people: birthdayPeople(list, googleNames, ymd), calendarError };
  }

  return lookup;
}

// ---------------------------------------------------------------------------
// Einzel-Einstellungen
// ---------------------------------------------------------------------------

/** ToDo-IDs mit reminders-Zeile (eigene Zeit oder „Aus") — für sie entfällt die Themen-Nachricht. */
async function todosWithReminder(sb: Sb, todoIds: string[]): Promise<Set<string>> {
  if (!todoIds.length) return new Set();
  const { data, error } = await sb.from('reminders').select('todo_id').eq('kind', 'todo').in('todo_id', todoIds);
  if (error) throw new Error(error.message);
  return new Set(data.map((r) => r.todo_id).filter((id): id is string => Boolean(id)));
}

const eventTarget = (eventId: string, calendarId: string | null) => `${eventId}::${calendarId}`;

/**
 * Termine, für die eine reminders-Zeile die Themen-Nachricht ersetzt, als eventTarget-Schlüssel.
 * Eine eigene Zeit an einem inzwischen verschobenen Abo-Termin zählt nicht (reminderAppliesTo).
 */
async function eventsWithReminder(sb: Sb, events: CalendarEvent[]): Promise<Set<string>> {
  if (!events.length) return new Set();
  const { data, error } = await sb
    .from('reminders')
    .select('event_id,calendar_id,notify_at,start_at')
    .eq('kind', 'event')
    .in('event_id', [...new Set(events.map((e) => e.id))]);
  if (error) throw new Error(error.message);
  const rows = new Map(data.map((r) => [eventTarget(r.event_id ?? '', r.calendar_id), r]));
  const taken = new Set<string>();
  for (const e of events) {
    const key = eventTarget(e.id, e.calendar_id);
    const row = rows.get(key);
    if (row && reminderAppliesTo(row, e.start)) taken.add(key);
  }
  return taken;
}

async function reminderPayload(sb: Sb, r: ReminderRow): Promise<PushPayload | null> {
  const tag = `rem-${r.id}`;
  if (r.kind !== 'todo') {
    let title = r.title || 'Termin';
    // Abo-Termin: nur senden, wenn er im Feed noch zu dieser Zeit steht. Verschoben,
    // abgesagt oder Abo weg → verwerfen (den neuen Termin deckt der Vorlauf des Themas).
    // Feed gerade nicht lesbar → senden wie gespeichert.
    if (isSubscriptionId(r.calendar_id) && r.event_id && r.start_at) {
      const hit = await lookupSubscriptionEvent(sb, r.calendar_id!, r.event_id, r.start_at);
      if (hit.status === 'gone') return null;
      if (hit.status === 'found') title = hit.summary;
    }
    return { title, body: reminderEventBody(r.start_at), url: '/calendar', tag };
  }
  if (!r.todo_id) return null;
  const { data: todo, error } = await sb
    .from('todos')
    .select('title,status,due_at,deleted_at')
    .eq('id', r.todo_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!todo || todo.status === 'done' || todo.deleted_at) return null;
  return { title: todo.title || 'ToDo', body: reminderTodoBody(todo.due_at), url: '/todos', tag };
}

// ---------------------------------------------------------------------------
// Schritte
// ---------------------------------------------------------------------------

/** Eigene Erinnerungen — unabhängig von den Themen-Schaltern. */
async function runReminders(t: Tick) {
  const nowISO = new Date(t.now).toISOString();
  const { data: due, error } = await t.sb
    .from('reminders')
    .select('*')
    .not('notify_at', 'is', null)
    .is('sent_at', null)
    .lte('notify_at', nowISO);
  if (error) throw new Error(error.message);

  for (const r of due) {
    if (!r.notify_at || !t.sender.hasSubscribers()) continue;
    // Atomar beanspruchen: nur ein Tick gewinnt das UPDATE mit sent_at IS NULL.
    const { data: claimed, error: claimError } = await t.sb
      .from('reminders')
      .update({ sent_at: nowISO })
      .eq('id', r.id)
      .is('sent_at', null)
      .select('id');
    if (claimError) throw new Error(claimError.message);
    if (!claimed.length) continue;
    const release = async () => {
      const { error: releaseError } = await t.sb.from('reminders').update({ sent_at: null }).eq('id', r.id);
      if (releaseError) noteError(t, 'reminder', `Claim reminder:${r.id} nicht freigegeben: ${releaseError.message}`);
    };

    // Zu alt (Cron lag lange still) → still verwerfen, der Claim bleibt.
    if (Date.parse(r.notify_at) < t.now - REMINDER_STALE_MS) continue;

    let payload: PushPayload | null;
    try {
      payload = await reminderPayload(t.sb, r);
    } catch (e) {
      await release();
      throw e;
    }
    // ToDo erledigt oder gelöscht, Abo-Termin verschoben oder abgesagt → kein Push, der Claim bleibt.
    if (!payload) continue;

    const result = await t.sender.send(payload);
    if (result.error) noteError(t, 'reminder', result.error);
    if (!result.anyDelivered) {
      await release();
      continue;
    }
    t.sent.reminder++;
    await t.sb
      .from('notification_log')
      .upsert(
        { key: notificationKey.reminder(r.id, r.notify_at), category: 'reminder', title: payload.title, body: payload.body },
        { onConflict: 'key', ignoreDuplicates: true },
      );
  }
}

async function runEvents(t: Tick) {
  const { enabled, leadMinutes } = t.prefs.events;
  if (!enabled) return;
  let cal: CalendarWindow | null;
  try {
    cal = await t.calendar(leadWindow(t.now, [leadMinutes], LEAD_GRACE_MS));
  } catch (e) {
    // Keine Quelle lesbar: Google- und Tabellenfehler zählen für den Tick, einzelne kaputte Abos nicht.
    if (e instanceof CalendarUnreadableError) return noteCalendarErrors(t, 'events', e.errors);
    throw e;
  }
  if (!cal) return;
  noteCalendarErrors(t, 'events', cal.errors);
  const due = cal.events.filter(
    (e) =>
      isLeadNotifiable(e) &&
      Date.parse(e.start) > t.now &&
      dueLeads(e.start, [leadMinutes], t.now, LEAD_GRACE_MS).length > 0,
  );
  if (!due.length) return;

  const taken = await eventsWithReminder(t.sb, due);
  for (const e of due) {
    if (taken.has(eventTarget(e.id, e.calendar_id))) continue;
    await deliver(t, 'events', notificationKey.event(e.calendar_id, e.id, e.start), {
      title: e.summary,
      body: eventBody(e.start, e.location),
      url: '/calendar',
      tag: `event-${e.id}`,
    });
  }
}

async function runTodos(t: Tick) {
  const { enabled, leadMinutes, allDayTime } = t.prefs.todos;
  if (!enabled) return;

  // a) Mit Uhrzeit: Vorlauf vor der Fälligkeit.
  const w = leadWindow(t.now, [leadMinutes], LEAD_GRACE_MS);
  const { data: timedRows, error } = await t.sb
    .from('todos')
    .select('id,title,due_at')
    .is('deleted_at', null)
    .neq('status', 'done')
    .gte('due_at', w.from)
    .lte('due_at', w.to);
  if (error) throw new Error(error.message);
  const timed = timedRows.filter(
    (row): row is typeof row & { due_at: string } =>
      Boolean(row.due_at) &&
      !isAllDayDue(row.due_at!) &&
      dueLeads(row.due_at!, [leadMinutes], t.now, LEAD_GRACE_MS).length > 0,
  );
  const timedTaken = await todosWithReminder(t.sb, timed.map((row) => row.id));
  for (const row of timed) {
    if (timedTaken.has(row.id)) continue;
    await deliver(t, 'todos', notificationKey.todo(row.id, row.due_at), {
      title: row.title || 'ToDo',
      body: todoLeadBody(row.due_at, leadMinutes),
      url: '/todos',
      tag: `todo-${row.id}`,
    });
  }

  // b) Ganztägig heute fällig: eine gesammelte Nachricht zur gewählten Uhrzeit.
  if (allDayTime === null || !isDue(berlinWallTime(t.today, allDayTime), t.now, DAILY_GRACE_MS)) return;
  const key = notificationKey.todosDay(t.today);
  if (await isLogged(t.sb, key)) return;
  const { data: dayRows, error: dayError } = await t.sb
    .from('todos')
    .select('id,title')
    .is('deleted_at', null)
    .neq('status', 'done')
    .eq('due_at', `${t.today}T00:00:00Z`)
    .order('sort_order');
  if (dayError) throw new Error(dayError.message);
  const dayTaken = await todosWithReminder(t.sb, dayRows.map((row) => row.id));
  const titles = dayRows.filter((row) => !dayTaken.has(row.id)).map((row) => row.title);
  if (!titles.length) return;
  await deliver(t, 'todos', key, {
    title: 'Heute fällig',
    body: todosDayBody(titles),
    url: '/todos',
    tag: `todos-day-${t.today}`,
  });
}

async function runBirthdays(t: Tick) {
  const { enabled, time, daysBefore } = t.prefs.birthdays;
  if (!enabled || !isDue(berlinWallTime(t.today, time), t.now, DAILY_GRACE_MS)) return;
  for (const d of daysBefore) {
    const key = notificationKey.birthdays(t.today, d);
    if (await isLogged(t.sb, key)) continue;
    const { people, calendarError } = await t.birthdaysOn(addDaysYMD(t.today, d));
    if (calendarError) noteError(t, 'birthdays', calendarError);
    if (!people.length) continue;
    await deliver(t, 'birthdays', key, {
      title: `🎂 ${birthdayHeadline(d)}`,
      body: calendarError ? `${birthdayPeopleText(people)} · Kalender nicht lesbar` : birthdayPeopleText(people),
      url: '/contacts',
      tag: `birthdays-${t.today}-${d}`,
    });
  }
}

async function runLearnweb(t: Tick) {
  const { enabled, leadMinutes } = t.prefs.learnweb;
  if (!enabled) return;
  const { data, error } = await t.sb
    .from('learnweb_events')
    .select('id,name,starts_at,learnweb_courses(shortname)')
    .is('deleted_at', null)
    .gt('starts_at', new Date(t.now).toISOString())
    .lte('starts_at', leadWindow(t.now, leadMinutes, LEAD_GRACE_MS).to);
  if (error) throw new Error(error.message);
  for (const ev of data) {
    for (const lead of dueLeads(ev.starts_at, leadMinutes, t.now, LEAD_GRACE_MS)) {
      await deliver(t, 'learnweb', notificationKey.learnweb(ev.id, ev.starts_at, lead), {
        title: ev.name,
        body: learnwebBody(ev.learnweb_courses?.shortname ?? null, ev.starts_at),
        url: '/learnweb',
        tag: `learnweb-${ev.id}`,
      });
    }
  }
}

/**
 * Tagesüberblick. Datenbankfehler halten ihn bis zum nächsten Tick zurück; ein
 * nicht lesbarer Kalender nicht — dann kommt der Überblick mit „Termine nicht lesbar",
 * bei einer ausgefallenen von mehreren Quellen mit „Termine teils nicht lesbar".
 */
async function runDigest(t: Tick) {
  const { enabled, time } = t.prefs.digest;
  if (!enabled || !isDue(berlinWallTime(t.today, time), t.now, DAILY_GRACE_MS)) return;
  const key = notificationKey.digest(t.today);
  if (await isLogged(t.sb, key)) return;

  const day = berlinDayWindow(t.today);
  let events: CalendarEvent[] = [];
  let calendarFailed = false;
  let calendarIncomplete = false;
  try {
    const cal = await t.calendar(t.calendarDays);
    if (cal) {
      events = eventsOnDay(cal.events, t.today);
      calendarIncomplete = cal.errors.length > 0;
      noteCalendarErrors(t, 'digest', cal.errors);
    }
  } catch (e) {
    calendarFailed = true;
    if (e instanceof CalendarUnreadableError) noteCalendarErrors(t, 'digest', e.errors);
    else noteError(t, 'digest', `Kalender: ${errorText(e)}`);
  }
  // Getimt im Berliner Tagesfenster; ganztägig heute (00:00 UTC) liegt ebenfalls darin.
  // Backlog-ToDos zählen nicht mit: Sie sind geparkt und erscheinen auch in Heute nicht.
  const { count: todoCount, error } = await t.sb
    .from('todos')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .neq('status', 'done')
    .eq('backlog', false)
    .gte('due_at', day.from)
    .lt('due_at', day.to);
  if (error) throw new Error(error.message);
  // Ein Kalenderfehler der Geburtstage ist derselbe wie oben (gleiches Fenster, gleicher Abruf).
  const { people } = await t.birthdaysOn(t.today);

  await deliver(t, 'digest', key, {
    title: 'Guten Morgen',
    body: digestBody({ events, calendarFailed, calendarIncomplete, todoCount: todoCount ?? 0, birthdayNames: people.map((p) => p.name) }),
    url: '/',
    tag: `digest-${t.today}`,
  });
}

/** Einmal pro Stunde: alte Protokollzeilen löschen. */
async function pruneLog(t: Tick) {
  if (new Date(t.now).getUTCMinutes() !== PRUNE_MINUTE) return;
  const cutoff = new Date(t.now - LOG_RETENTION_MS).toISOString();
  const { error } = await t.sb.from('notification_log').delete().lt('sent_at', cutoff);
  if (error) throw new Error(error.message);
}

const STEPS: [Step, (t: Tick) => Promise<void>][] = [
  ['reminder', runReminders],
  ['events', runEvents],
  ['todos', runTodos],
  ['birthdays', runBirthdays],
  ['learnweb', runLearnweb],
  ['digest', runDigest],
  ['prune', pruneLog],
];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: ApiRequest, res: ApiResponse) {
  // Bearer-Secret des pg_cron-Jobs. Es liegt nur im Supabase-Vault; verglichen
  // wird in der Datenbank (verify_cron_secret), nur ein exaktes true zählt.
  const raw = req.headers['authorization'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!bearer) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const sb = admin();
  const { data: valid, error: verifyError } = await sb.rpc('verify_cron_secret', { candidate: bearer });
  if (verifyError) {
    console.error('verify_cron_secret failed', verifyError);
    res.status(500).json({ error: 'verify_cron_secret failed' });
    return;
  }
  if (valid !== true) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!configureVapid()) {
    res.status(500).json({ error: 'VAPID_PRIVATE_KEY not configured' });
    return;
  }

  const { data: subs, error: subsError } = await sb.from('push_subscriptions').select('endpoint,p256dh,auth');
  if (subsError) {
    res.status(500).json({ error: subsError.message });
    return;
  }
  // Ohne Geräte gibt es niemanden zu benachrichtigen — nichts claimen, damit
  // Anlässe nach dem nächsten Abo noch ankommen.
  if (!subs.length) {
    res.status(200).json({ ok: true, note: 'no subscriptions' });
    return;
  }

  // Ohne lesbare Auswahl nicht auf Defaults zurückfallen: die würden
  // abgeschaltete Themen wieder einschalten.
  const { data: settings, error: settingsError } = await sb
    .from('notification_settings')
    .select('prefs')
    .eq('id', 1)
    .maybeSingle();
  if (settingsError) {
    res.status(500).json({ error: settingsError.message });
    return;
  }

  const now = Date.now();
  const today = berlinDate(now);
  const prefs = normalizePrefs(settings?.prefs);
  const google = googleAccess(sb);
  const calendar = calendarAccess(sb, google);
  const calendarDays = prefs.birthdays.enabled
    ? birthdayWindow(today, prefs.birthdays.daysBefore)
    : berlinDayWindow(today);
  const t: Tick = {
    sb,
    now,
    today,
    prefs,
    sender: makeSender(sb, subs),
    calendar,
    calendarDays,
    birthdaysOn: birthdaySource(sb, google, calendarDays),
    sent: { reminder: 0, events: 0, todos: 0, birthdays: 0, learnweb: 0, digest: 0 },
    errors: {},
  };

  for (const [step, run] of STEPS) {
    try {
      await run(t);
    } catch (e) {
      noteError(t, step, e);
    }
  }

  res.status(200).json({
    ok: Object.keys(t.errors).length === 0,
    pushes: t.sender.state.pushes,
    prunedSubs: t.sender.state.pruned,
    sent: t.sent,
    errors: t.errors,
  });
}
