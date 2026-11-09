import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '@larvis/shared';
import { birthdayName, dayTimeLabel, eventsByDay, eventSpan, isBirthday, layoutDay, layoutWeek, withSpans } from '../src/features/calendar/layout';

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
const WEEK = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
const trip = ev({ id: 'trip', start: '2026-09-25T18:00:00', end: '2026-09-27T10:00:00' });

test('ganztägiges Ende ist exklusiv', () => {
  assert.deepEqual(eventSpan(ev({ id: 'a', all_day: true, start: '2026-10-01', end: '2026-10-03' })), {
    startKey: '2026-10-01',
    endKey: '2026-10-02',
  });
});

test('Ende um Mitternacht zählt zum Vortag', () => {
  assert.equal(eventSpan(ev({ id: 'a', start: '2026-09-25T20:00:00', end: '2026-09-26T00:00:00' })).endKey, '2026-09-25');
});

test('Termin über mehrere Tage wird ein Balken über alle Tage', () => {
  const { bars, chips } = layoutWeek(WEEK, withSpans([trip]));
  assert.equal(bars.length, 1);
  assert.deepEqual([bars[0].col, bars[0].span, bars[0].lane], [4, 3, 0]);
  assert.ok(chips.every((c) => c.length === 0));
});

test('Balken über die Wochengrenze wird beschnitten und markiert', () => {
  const malle = ev({ id: 'malle', all_day: true, start: '2026-09-13', end: '2026-09-24' });
  const [bar] = layoutWeek(WEEK, withSpans([malle])).bars;
  assert.deepEqual([bar.col, bar.span, bar.startsBefore, bar.endsAfter], [0, 3, true, false]);
});

test('überlappende Balken bekommen eigene Zeilen, freie Zeilen werden wiederverwendet', () => {
  const a = ev({ id: 'a', all_day: true, start: '2026-09-21', end: '2026-09-24' });
  const b = ev({ id: 'b', all_day: true, start: '2026-09-22', end: '2026-09-23' });
  const c = ev({ id: 'c', all_day: true, start: '2026-09-25', end: '2026-09-26' });
  const { bars, lanes } = layoutWeek(WEEK, withSpans([a, b, c]));
  const lane = Object.fromEntries(bars.map((x) => [x.ev.id, x.lane]));
  assert.deepEqual(lane, { a: 0, b: 1, c: 0 });
  assert.equal(lanes, 2);
});

test('Tagesansicht beschneidet einen Mehrtages-Termin auf den Tag', () => {
  const spanned = withSpans([trip]);
  const fri = layoutDay('2026-09-25', spanned);
  assert.deepEqual([fri.timed[0].startMin, fri.timed[0].endMin, fri.timed[0].endsAfter], [18 * 60, 24 * 60, true]);
  const sat = layoutDay('2026-09-26', spanned);
  assert.equal(sat.timed.length, 0);
  assert.equal(sat.allDay.length, 1);
  const sun = layoutDay('2026-09-27', spanned);
  assert.deepEqual([sun.timed[0].startMin, sun.timed[0].endMin, sun.timed[0].startsBefore], [0, 10 * 60, true]);
});

test('überlappende Termine teilen sich die Breite, spätere nutzen sie wieder ganz', () => {
  const a = ev({ id: 'a', start: '2026-09-28T09:00:00', end: '2026-09-28T18:00:00' });
  const b = ev({ id: 'b', start: '2026-09-28T10:00:00', end: '2026-09-28T11:00:00' });
  const c = ev({ id: 'c', start: '2026-09-28T18:00:00', end: '2026-09-28T21:30:00' });
  const by = Object.fromEntries(layoutDay('2026-09-28', withSpans([a, b, c])).timed.map((t) => [t.ev.id, t]));
  assert.deepEqual([by.a.column, by.a.columns, by.b.column, by.b.columns], [0, 2, 1, 2]);
  assert.deepEqual([by.c.column, by.c.columns], [0, 1]);
});

test('Geburtstage: Google-Typ und Titel aus Kontakt-Import', () => {
  const typed = ev({ id: 't', summary: 'Erika Musterfrau', all_day: true, event_type: 'birthday', start: '2026-09-28', end: '2026-09-29' });
  const titled = ev({ id: 's', summary: 'Geburtstag Max', all_day: true, start: '2026-09-21', end: '2026-09-22' });
  assert.ok(isBirthday(typed) && isBirthday(titled));
  assert.equal(birthdayName(titled), 'Max');
  assert.equal(birthdayName(typed), 'Erika Musterfrau');
  assert.ok(!isBirthday(trip));
});

test('„Geburtstagsgeschenk" ist kein Geburtstag', () => {
  assert.ok(!isBirthday(ev({ id: 'g', summary: 'Geburtstagsgeschenk Papa kaufen', all_day: true, start: '2026-09-21', end: '2026-09-22' })));
});

test('Zeitangabe folgt dem Tag: Beginn, ganzer Tag, Ende', () => {
  assert.equal(dayTimeLabel(trip, '2026-09-25'), 'ab 18:00');
  assert.equal(dayTimeLabel(trip, '2026-09-26'), 'ganztägig');
  assert.equal(dayTimeLabel(trip, '2026-09-27'), 'bis 10:00');
});

test('herüberlaufender Termin steht am Folgetag vor den Terminen des Tages', () => {
  const frueh = ev({ id: 'frueh', start: '2026-09-27T09:00:00', end: '2026-09-27T09:30:00' });
  const list = eventsByDay(withSpans([frueh, trip]), ['2026-09-27']).get('2026-09-27')!;
  assert.deepEqual(list.map((x) => x.id), ['trip', 'frueh']);
});
