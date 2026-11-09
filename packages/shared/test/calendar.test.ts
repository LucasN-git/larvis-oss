import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareEventStart } from '../src/calendar.js';

const sorted = (events: { id: string; start: string; all_day?: boolean }[]) =>
  [...events].sort(compareEventStart).map((e) => e.id);

test('compareEventStart: Zeitpunkt statt Text bei gemischten Offsets', () => {
  // 09:30+02:00 = 07:30Z liegt vor 08:00Z, obwohl der Text „09…" größer ist.
  assert.deepEqual(
    sorted([
      { id: 'abo', start: '2026-09-15T08:00:00.000Z' },
      { id: 'google', start: '2026-09-15T09:30:00+02:00' },
    ]),
    ['google', 'abo'],
  );
});

test('compareEventStart: ganztägige am Berliner Tag zuerst, auch vor 00:30 Uhr', () => {
  assert.deepEqual(
    sorted([
      { id: 'nachts', start: '2026-09-15T00:30:00+02:00' },
      { id: 'vortag-spät', start: '2026-09-14T23:30:00+02:00' },
      { id: 'ganztägig', start: '2026-09-15', all_day: true },
      { id: 'winter-nachts', start: '2026-01-10T23:30:00.000Z' },
      { id: 'winter-ganztägig', start: '2026-01-11', all_day: true },
    ]),
    ['winter-ganztägig', 'winter-nachts', 'vortag-spät', 'ganztägig', 'nachts'],
  );
});
