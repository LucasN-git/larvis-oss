import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '@larvis/shared';
import { buildBoard, countdown, weekKeys } from '../src/features/calendar/board';

function ev(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'start' | 'end'>): CalendarEvent {
  return {
    summary: partial.id,
    description: null,
    location: null,
    all_day: false,
    html_link: null,
    calendar: 'larvis',
    calendar_id: 'c',
    calendar_name: null,
    color: null,
    editable: true,
    project_id: null,
    tags: [],
    todo_id: null,
    event_type: 'default',
    recurring_event_id: null,
    place_id: null,
    ...partial,
  } as CalendarEvent;
}

// Lokale Zeiten ohne Offset, damit der Test in jeder Zeitzone dieselben Tage trifft.
const NOW = new Date('2026-09-30T10:13:00').getTime();
const events = [
  ev({ id: 'standup', start: '2026-09-30T10:30:00', end: '2026-09-30T10:45:00' }),
  ev({ id: 'kaffee', start: '2026-09-30T10:00:00', end: '2026-09-30T10:23:00' }),
  ev({ id: 'launch', start: '2026-09-30T10:09:00', end: '2026-09-30T10:36:00' }),
  ev({ id: 'frueh', start: '2026-09-30T08:00:00', end: '2026-09-30T09:00:00' }),
  ev({ id: 'urlaub', all_day: true, start: '2026-09-30', end: '2026-10-01' }),
  ev({ id: 'morgen', start: '2026-10-01T09:00:00', end: '2026-10-01T10:00:00' }),
  ev({ id: 'nacht', start: '2026-09-29T22:00:00', end: '2026-09-30T11:00:00' }),
];

test('Tafel: laufende vor kommenden, die bald endende zuerst; abgefahrene getrennt', () => {
  const b = buildBoard(events, '2026-09-30', NOW);
  assert.deepEqual(b.rows.map((r) => [r.ev.id, r.state]), [
    ['kaffee', 'live'],
    ['launch', 'live'],
    ['nacht', 'live'],
    ['standup', 'upcoming'],
  ]);
  assert.deepEqual(b.departed.map((r) => r.ev.id), ['frueh']);
  assert.deepEqual(b.allDay.map((e) => e.id), ['urlaub']);
});

test('Tafel: Termin über Mitternacht beginnt auf dem Folgetag um 0 Uhr', () => {
  const row = buildBoard(events, '2026-09-30', NOW).rows.find((r) => r.ev.id === 'nacht')!;
  assert.equal(row.start, new Date('2026-09-30T00:00:00').getTime());
  assert.ok(row.progress > 0.9 && row.progress < 1);
});

test('Tafel: Fortschritt eines laufenden Termins', () => {
  const kaffee = buildBoard(events, '2026-09-30', NOW).rows[0];
  assert.ok(Math.abs(kaffee.progress - 13 / 23) < 1e-9);
});

test('Countdown: Minuten unter einer Stunde, sonst Stunden:Minuten', () => {
  assert.deepEqual(countdown(10 * 60_000), { value: '10', unit: 'min' });
  assert.deepEqual(countdown(9.2 * 60_000), { value: '10', unit: 'min' });
  assert.deepEqual(countdown(118 * 60_000), { value: '1:58', unit: 'std' });
  assert.deepEqual(countdown(-5000), { value: '0', unit: 'min' });
});

test('Wochenstreifen: sieben Tage ab Montag', () => {
  assert.deepEqual(weekKeys(new Date('2026-09-28T00:00:00')), [
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  ]);
});
