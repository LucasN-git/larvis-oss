import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFS,
  addDaysYMD,
  ageOn,
  berlinDate,
  berlinWallTime,
  birthdayFallsOn,
  birthdayHeadline,
  isAllDayDue,
  isDue,
  leadLabel,
  normalizePrefs,
  notificationKey,
} from '../api/_lib/notificationPrefs.js';
import { berlinWallTime as sharedBerlinWallTime } from '@larvis/shared';

test('ohne gespeicherte Auswahl gelten die Defaults, Geburtstage sind an', () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs({}), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs('kaputt'), DEFAULT_PREFS);
  assert.equal(normalizePrefs(undefined).birthdays.enabled, true);
});

test('Geburtstage lassen sich abwählen, der Rest bleibt Default', () => {
  const prefs = normalizePrefs({ birthdays: { enabled: false } });
  assert.equal(prefs.birthdays.enabled, false);
  assert.equal(prefs.birthdays.time, DEFAULT_PREFS.birthdays.time);
  assert.deepEqual(prefs.events, DEFAULT_PREFS.events);
});

test('nur Preset-Werte überstehen die Normalisierung', () => {
  const prefs = normalizePrefs({
    birthdays: { enabled: true, time: '08:15', daysBefore: [7, 0, 99, 0] },
    events: { enabled: 'ja', leadMinutes: 45 },
    todos: { enabled: true, leadMinutes: 0, allDayTime: '07:00' },
    learnweb: { enabled: true, leadMinutes: [] },
    digest: { enabled: true, time: '06:30' },
  });
  assert.equal(prefs.birthdays.time, '08:00');
  assert.deepEqual(prefs.birthdays.daysBefore, [0, 7]);
  assert.equal(prefs.events.enabled, DEFAULT_PREFS.events.enabled);
  assert.equal(prefs.events.leadMinutes, 30);
  assert.equal(prefs.todos.leadMinutes, 0);
  assert.equal(prefs.todos.allDayTime, '07:00');
  assert.deepEqual(prefs.learnweb.leadMinutes, [1440]);
  assert.equal(prefs.digest.time, '06:30');
  assert.equal(normalizePrefs({ todos: { allDayTime: null } }).todos.allDayTime, null);
});

test('Berliner Wanduhrzeit → UTC, Sommer, Winter und Umstellungstage', () => {
  assert.equal(berlinWallTime('2026-09-15', '08:00'), Date.parse('2026-09-15T06:00:00Z'));
  assert.equal(berlinWallTime('2026-01-10', '08:00'), Date.parse('2026-01-10T07:00:00Z'));
  assert.equal(berlinWallTime('2026-03-29', '08:00'), Date.parse('2026-03-29T06:00:00Z'));
  assert.equal(berlinWallTime('2026-10-25', '08:00'), Date.parse('2026-10-25T07:00:00Z'));
  assert.equal(berlinWallTime('2026-09-15', '00:00'), Date.parse('2026-09-14T22:00:00Z'));
});

test('Kalendertag in Berlin kippt um Mitternacht Ortszeit', () => {
  assert.equal(berlinDate(Date.parse('2026-09-14T22:30:00Z')), '2026-09-15');
  assert.equal(berlinDate(Date.parse('2026-09-14T21:59:00Z')), '2026-09-14');
  assert.equal(berlinDate(Date.parse('2026-12-31T23:30:00Z')), '2027-01-01');
});

test('Datumsrechnung über Monats- und Jahresgrenzen', () => {
  assert.equal(addDaysYMD('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysYMD('2026-03-01', -1), '2026-02-28');
  assert.equal(addDaysYMD('2026-09-15', 7), '2026-09-22');
});

test('fällig heißt: Zeitpunkt erreicht und nicht älter als die Kulanz', () => {
  const now = Date.parse('2026-09-15T06:00:00Z');
  assert.equal(isDue(now, now, 60_000), true);
  assert.equal(isDue(now + 1, now, 60_000), false);
  assert.equal(isDue(now - 60_000, now, 60_000), false);
  assert.equal(isDue(now - 59_999, now, 60_000), true);
});

test('Geburtstag am 29.2. fällt in Nicht-Schaltjahren auf den 28.2.', () => {
  assert.equal(birthdayFallsOn('1990-02-29', '2027-02-28'), true);
  assert.equal(birthdayFallsOn('1990-02-29', '2028-02-29'), true);
  assert.equal(birthdayFallsOn('1990-02-29', '2028-02-28'), false);
  assert.equal(birthdayFallsOn('1604-09-15', '2026-09-15'), true);
  assert.equal(birthdayFallsOn('1990-09-15', '2026-09-16'), false);
});

test('Alter nur mit bekanntem Geburtsjahr', () => {
  assert.equal(ageOn('1990-09-15', true, '2026-09-15'), 36);
  assert.equal(ageOn('1604-09-15', true, '2026-09-15'), null);
  assert.equal(ageOn('1990-09-15', false, '2026-09-15'), null);
});

test('Überschriften und Vorlauf-Labels', () => {
  assert.equal(birthdayHeadline(0), 'Heute Geburtstag');
  assert.equal(birthdayHeadline(1), 'Morgen Geburtstag');
  assert.equal(birthdayHeadline(3), 'In 3 Tagen Geburtstag');
  assert.equal(birthdayHeadline(7), 'In einer Woche Geburtstag');
  assert.equal(leadLabel(0), 'Zur Fälligkeit');
  assert.equal(leadLabel(30), '30 Min');
  assert.equal(leadLabel(120), '2 Std');
  assert.equal(leadLabel(1440), '1 Tag');
  assert.equal(leadLabel(2880), '2 Tage');
});

test('ganztägige ToDo-Fälligkeit liegt auf 00:00 UTC', () => {
  assert.equal(isAllDayDue('2026-09-15T00:00:00.000Z'), true);
  assert.equal(isAllDayDue('2026-09-15T08:00:00.000Z'), false);
});

test('Protokoll-Schlüssel sind unabhängig von der Zeitzonen-Schreibweise', () => {
  assert.equal(
    notificationKey.event('cal', 'ev', '2026-09-15T10:00:00+02:00'),
    notificationKey.event('cal', 'ev', '2026-09-15T08:00:00Z'),
  );
  assert.notEqual(
    notificationKey.learnweb('id', '2026-09-15T08:00:00Z', 60),
    notificationKey.learnweb('id', '2026-09-15T08:00:00Z', 1440),
  );
});

test('berlinWallTime in @larvis/shared bleibt gleich der Fassung in api/', () => {
  for (const ymd of ['2026-07-15', '2026-01-15', '2026-03-29', '2026-10-25']) {
    for (const hhmm of ['00:00', '01:30', '02:00', '02:30', '03:00', '12:00', '23:59']) {
      assert.equal(sharedBerlinWallTime(ymd, hhmm), berlinWallTime(ymd, hhmm), `${ymd} ${hhmm}`);
    }
  }
});
