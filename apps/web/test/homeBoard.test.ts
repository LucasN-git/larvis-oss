import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayWindow } from '../src/features/calendar/todayWindow';

process.env.TZ = 'Europe/Berlin';

const DAY = 86_400_000;

/** Prüft, dass das Fenster genau die lokale Mitternacht davor und danach abdeckt. */
function check(now: Date) {
  const { back, days } = todayWindow(now);
  const min = new Date(now.getTime() - back * DAY);
  const max = new Date(now.getTime() + days * DAY);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  assert.ok(back >= 0, 'back nie negativ');
  assert.ok(days > 0, 'days immer positiv (0 hieße in der API „30 Tage")');
  assert.ok(min.getTime() <= start.getTime(), `beginnt spätestens um 00:00 (${min.toString()})`);
  assert.ok(start.getTime() - min.getTime() < 120_000, 'beginnt höchstens 2 min vor 00:00');
  assert.ok(max.getTime() >= end.getTime(), `endet frühestens um 24:00 (${max.toString()})`);
  assert.ok(max.getTime() - end.getTime() < 120_000, 'endet höchstens 2 min nach 24:00');
  return { back, days };
}

test('todayWindow um 00:00', () => {
  const { back, days } = check(new Date(2026, 9, 12, 0, 0));
  assert.equal(back, 0);
  assert.equal(days, 1);
});

test('todayWindow um 12:00', () => {
  const { back, days } = check(new Date(2026, 9, 12, 12, 0));
  assert.equal(back, 0.5);
  assert.equal(days, 0.5);
});

test('todayWindow um 23:59', () => {
  const { back, days } = check(new Date(2026, 9, 12, 23, 59));
  assert.ok(back > 0.99);
  assert.ok(days > 0 && days < 0.002);
});

// Zeitumstellung: in Europe/Berlin hat der 29.03.2026 nur 23 Stunden, der 25.10.2026
// 25 Stunden. Die Prüfungen in `check` laufen über lokale Mitternächte und gelten in
// jeder Zeitzone; mit TZ=Europe/Berlin decken sie die kurzen und langen Tage ab.
for (const [label, y, m, d] of [
  ['Sommerzeit 29.03.2026', 2026, 2, 29],
  ['Winterzeit 25.10.2026', 2026, 9, 25],
] as const) {
  test(`todayWindow am Tag der ${label}`, () => {
    for (const h of [0, 1, 2, 3, 4, 12, 23]) check(new Date(y, m, d, h, 30));
    const start = new Date(y, m, d);
    const end = new Date(y, m, d + 1);
    const { back, days } = check(new Date(y, m, d, 12, 0));
    // Fenster = Länge des lokalen Tages (23, 24 oder 25 h).
    assert.ok(Math.abs((back + days) * DAY - (end.getTime() - start.getTime())) < 120_000);
  });
}
