import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berlinWallTime, planEventReminder, shiftReminder } from '../src/reminders.js';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const START = '2026-07-10T10:00:00.000Z';

test('reminder_minutes 30 and 90 set notifyAt before a timed event', () => {
  assert.deepEqual(planEventReminder({ start: START, reminder_minutes: 30 }, NOW), {
    action: 'set',
    notifyAt: '2026-07-10T09:30:00.000Z',
    startAt: START,
  });
  const p = planEventReminder({ start: START, reminder_minutes: 90 }, NOW);
  assert.equal(p.action, 'set');
  assert.equal(p.action === 'set' && p.notifyAt, '2026-07-10T08:30:00.000Z');
});

test('all-day in summer (CEST): reminder_at 20:00 Berlin the day before', () => {
  const at = new Date(berlinWallTime('2026-07-09', '20:00')).toISOString();
  assert.equal(at, '2026-07-09T18:00:00.000Z');
  assert.deepEqual(planEventReminder({ start: '2026-07-10', all_day: true, reminder_at: at }, NOW), {
    action: 'set',
    notifyAt: '2026-07-09T18:00:00.000Z',
    startAt: '2026-07-10',
  });
});

test('all-day in winter (CET): reminder_at 20:00 Berlin the day before', () => {
  const at = new Date(berlinWallTime('2026-12-09', '20:00')).toISOString();
  assert.equal(at, '2026-12-09T19:00:00.000Z');
  assert.deepEqual(planEventReminder({ start: '2026-12-10', all_day: true, reminder_at: at }, NOW), {
    action: 'set',
    notifyAt: '2026-12-09T19:00:00.000Z',
    startAt: '2026-12-10',
  });
});

test('reminder_at is taken as given, independent of start', () => {
  const p = planEventReminder({ start: START, reminder_at: '2026-07-01T12:34:00+02:00' }, NOW);
  assert.deepEqual(p, { action: 'set', notifyAt: '2026-07-01T10:34:00.000Z', startAt: START });
});

test('reminder_minutes null mutes', () => {
  assert.deepEqual(planEventReminder({ start: START, reminder_minutes: null }, NOW), { action: 'mute', startAt: START });
});

test('nothing given keeps the existing reminder', () => {
  assert.deepEqual(planEventReminder({ start: START }, NOW), { action: 'keep' });
  assert.deepEqual(planEventReminder({ start: START, reminder_at: null }, NOW), { action: 'keep' });
});

test('invalid combinations and values throw', () => {
  assert.throws(() => planEventReminder({ start: START, reminder_minutes: 10, reminder_at: START }, NOW), /nicht beides/);
  assert.throws(() => planEventReminder({ start: START, reminder_minutes: -5 }, NOW), /negativ/);
  assert.throws(() => planEventReminder({ start: 'irgendwann', reminder_minutes: 5 }, NOW), /Ungültiger Terminbeginn/);
  assert.throws(() => planEventReminder({ start: START, reminder_at: 'morgen' }, NOW), /Ungültiger reminder_at/);
});

test('notifyAt in the past throws', () => {
  assert.throws(
    () => planEventReminder({ start: '2026-06-01T00:20:00Z', reminder_minutes: 30 }, NOW),
    /Vergangenheit/,
  );
});

test('shiftReminder keeps the lead time', () => {
  assert.equal(
    shiftReminder({ notify_at: '2026-07-10T09:30:00.000Z', start_at: START }, '2026-07-12T15:00:00.000Z'),
    '2026-07-12T14:30:00.000Z',
  );
});

test('all-day reminder_minutes count from Berlin midnight, startAt stays the bare date', () => {
  assert.deepEqual(planEventReminder({ start: '2026-07-10', all_day: true, reminder_minutes: 60 }, NOW), {
    action: 'set',
    notifyAt: '2026-07-09T21:00:00.000Z',
    startAt: '2026-07-10',
  });
});

test('shiftReminder: bare-date start_at matches what Postgres stored (UTC midnight)', () => {
  assert.equal(
    shiftReminder({ notify_at: '2026-07-09T21:00:00+00:00', start_at: '2026-07-10T00:00:00+00:00' }, '2026-07-12'),
    '2026-07-11T21:00:00.000Z',
  );
});

test('shiftReminder: muted stays muted, missing start yields null', () => {
  assert.equal(shiftReminder({ notify_at: null, start_at: START }, '2026-07-12T15:00:00.000Z'), null);
  assert.equal(shiftReminder({ notify_at: '2026-07-10T09:30:00.000Z', start_at: null }, '2026-07-12T15:00:00.000Z'), null);
});

test('shiftReminder: all-day event moved across the DST switch keeps 23:00 Berlin the evening before', () => {
  assert.equal(
    shiftReminder({ notify_at: '2026-10-23T21:00:00+00:00', start_at: '2026-10-24T00:00:00+00:00' }, '2026-10-26'),
    '2026-10-25T22:00:00.000Z',
  );
});
