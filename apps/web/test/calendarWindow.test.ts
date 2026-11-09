import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '@larvis/shared';
import {
  CalendarUnreadableError,
  loadCalendarWindow,
  tickErrors,
  type SubscriptionWindow,
} from '../api/_lib/calendarWindow.js';
import { isLeadNotifiable, notificationKey, reminderAppliesTo } from '../api/_lib/notificationPrefs.js';

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1',
    summary: 'Termin',
    description: null,
    location: null,
    start: '2026-09-15T09:00:00+02:00',
    end: '2026-09-15T10:00:00+02:00',
    all_day: false,
    html_link: null,
    calendar: 'primary',
    calendar_id: 'cal',
    calendar_name: null,
    color: null,
    editable: true,
    project_id: null,
    tags: [],
    todo_id: null,
    event_type: 'default',
    recurring_event_id: null,
    ...over,
  };
}

const subEvent = ev({
  id: 'sub:11111111-1111-1111-1111-111111111111:abcdef',
  calendar: 'subscription',
  calendar_id: 'sub:11111111-1111-1111-1111-111111111111',
  editable: false,
  event_type: null,
  start: '2026-09-15T08:00:00.000Z',
});
const subs = (over: Partial<SubscriptionWindow> = {}) => async (): Promise<SubscriptionWindow> => ({
  events: [subEvent],
  errors: [],
  subscriptions: 1,
  listError: null,
  ...over,
});
const noSubs = subs({ events: [], subscriptions: 0 });
const brokenSub = subs({ events: [], errors: [{ name: 'Arbeit', error: 'HTTP 500', stale: false }] });
const notConnected = async () => null;
const googleDown = async (): Promise<CalendarEvent[]> => {
  throw new Error('invalid_grant');
};

test('ohne Google und ohne Abo gibt es keinen Kalender', async () => {
  assert.equal(await loadCalendarWindow({ google: notConnected, subscriptions: noSubs }), null);
});

test('Abos allein reichen: ohne Google-Verbindung kommen ihre Termine', async () => {
  const cal = await loadCalendarWindow({ google: notConnected, subscriptions: subs() });
  assert.deepEqual(cal, { events: [subEvent], errors: [] });
});

test('Google fällt aus, Abo läuft: der Abo-Termin bleibt und ist Vorlauf-fähig', async () => {
  const cal = await loadCalendarWindow({ google: googleDown, subscriptions: subs() });
  assert.ok(cal);
  assert.deepEqual(cal.events, [subEvent]);
  assert.deepEqual(cal.errors, [{ source: 'google', message: 'Google: invalid_grant' }]);
  assert.deepEqual(tickErrors(cal.errors), cal.errors);
  assert.equal(cal.events.filter(isLeadNotifiable).length, 1);
});

test('Abo ohne Stand fällt aus, Google läuft: Fehler gemeldet, aber kein Tick-Fehler', async () => {
  const g = ev({ id: 'g1' });
  const cal = await loadCalendarWindow({ google: async () => [g], subscriptions: brokenSub });
  assert.ok(cal);
  assert.deepEqual(cal.events, [g]);
  assert.deepEqual(cal.errors, [{ source: 'feed', message: 'Abo „Arbeit“: HTTP 500' }]);
  assert.deepEqual(tickErrors(cal.errors), []);
});

test('Abo mit letztem gelesenen Stand gilt als lesbar', async () => {
  const cal = await loadCalendarWindow({
    google: notConnected,
    subscriptions: subs({ errors: [{ name: 'Arbeit', error: 'Zeitlimit', stale: true }] }),
  });
  assert.deepEqual(cal, { events: [subEvent], errors: [] });
});

test('Abo-Tabelle nicht lesbar: echter Fehler, auch ohne Google', async () => {
  const listError = 'Kalender-Abos nicht lesbar (timeout).';
  const g = ev({ id: 'g1' });
  const cal = await loadCalendarWindow({
    google: async () => [g],
    subscriptions: subs({ events: [], subscriptions: 0, listError }),
  });
  assert.deepEqual(cal?.errors, [{ source: 'subscriptions', message: listError }]);
  assert.equal(tickErrors(cal!.errors).length, 1);
  await assert.rejects(
    loadCalendarWindow({ google: notConnected, subscriptions: subs({ events: [], subscriptions: 0, listError }) }),
    (e: unknown) => e instanceof CalendarUnreadableError && tickErrors(e.errors).length === 1,
  );
});

test('verschobener Abo-Termin: alte eigene Zeit ersetzt die Vorlauf-Nachricht nicht mehr', () => {
  // Der Termin behält beim Verschieben seine id, nur der Beginn ändert sich.
  const moved = { ...subEvent, start: '2026-09-15T10:00:00.000Z' };
  const custom = { calendar_id: subEvent.calendar_id, notify_at: '2026-09-15T07:30:00.000Z', start_at: subEvent.start };
  assert.equal(isLeadNotifiable(moved), true);
  assert.equal(reminderAppliesTo(custom, subEvent.start), true);
  assert.equal(reminderAppliesTo(custom, moved.start), false);
  // „Aus" gilt weiter, auch nach dem Verschieben.
  assert.equal(reminderAppliesTo({ ...custom, notify_at: null }, moved.start), true);
  // Gleicher Zeitpunkt mit anderer Schreibweise zählt als gleich.
  assert.equal(reminderAppliesTo(custom, '2026-09-15T10:00:00+02:00'), true);
  // Google-Termine: die Zeile gilt immer.
  assert.equal(reminderAppliesTo({ ...custom, calendar_id: 'primary' }, moved.start), true);
});

test('scheitert jede eingerichtete Quelle ohne einen Termin, wirft der Abruf', async () => {
  await assert.rejects(
    loadCalendarWindow({ google: googleDown, subscriptions: brokenSub }),
    /Google: invalid_grant; Abo „Arbeit“: HTTP 500/,
  );
  await assert.rejects(loadCalendarWindow({ google: googleDown, subscriptions: noSubs }), /invalid_grant/);
});

test('nur kaputte Abos ohne Google: nicht lesbar, aber kein Tick-Fehler', async () => {
  await assert.rejects(
    loadCalendarWindow({ google: notConnected, subscriptions: brokenSub }),
    (e: unknown) => e instanceof CalendarUnreadableError && tickErrors(e.errors).length === 0,
  );
});

test('Versandschlüssel trägt die Abo-Kalender-ID unverändert', () => {
  assert.equal(
    notificationKey.event(subEvent.calendar_id, subEvent.id, subEvent.start),
    `event:${subEvent.calendar_id}:${subEvent.id}:2026-09-15T08:00:00.000Z`,
  );
});
