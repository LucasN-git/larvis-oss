import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '@larvis/shared';
import {
  berlinDayWindow,
  birthdayPeople,
  birthdayPeopleText,
  birthdayWindow,
  contactDisplayName,
  digestBody,
  dueLeads,
  eventBody,
  eventsOnDay,
  googleBirthdaysOn,
  leadWindow,
  learnwebBody,
  matchesContact,
  reminderTodoBody,
  shortList,
  todoLeadBody,
  todosDayBody,
  type BirthdayContact,
} from '../api/_lib/notificationContent.js';
import { LEAD_GRACE_MS, isLeadNotifiable } from '../api/_lib/notificationPrefs.js';

const MIN = 60_000;

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
    place_id: null,
    ...over,
  };
}

function contact(over: Partial<BirthdayContact>): BirthdayContact {
  return { first_name: '', last_name: '', nickname: null, birthday: null, birthday_year_known: true, ...over };
}

test('Vorlauf-Fenster findet jeden fälligen Beginn, auch über mehrere Vorläufe', () => {
  const now = Date.parse('2026-09-15T06:00:00Z');
  const w = leadWindow(now, [30], LEAD_GRACE_MS);
  assert.equal(w.from, '2026-09-15T06:15:00.000Z');
  assert.equal(w.to, '2026-09-15T06:31:00.000Z');
  const multi = leadWindow(now, [60, 1440], LEAD_GRACE_MS);
  assert.equal(multi.from, '2026-09-15T06:45:00.000Z');
  assert.equal(multi.to, '2026-09-16T06:01:00.000Z');
});

test('fällige Vorläufe: Beginn minus Vorlauf liegt im Kulanzfenster', () => {
  const now = Date.parse('2026-09-15T06:00:00Z');
  assert.deepEqual(dueLeads('2026-09-15T06:30:00Z', [30], now, LEAD_GRACE_MS), [30]);
  assert.deepEqual(dueLeads('2026-09-15T08:30:00+02:00', [30], now, LEAD_GRACE_MS), [30]);
  assert.deepEqual(dueLeads('2026-09-15T06:15:00Z', [30], now, LEAD_GRACE_MS), []);
  assert.deepEqual(dueLeads('2026-09-15T06:31:00Z', [30], now, LEAD_GRACE_MS), []);
  assert.deepEqual(dueLeads('2026-09-16T06:00:00Z', [60, 1440], now, LEAD_GRACE_MS), [1440]);
  // Vorlauf 0 ist genau zur Fälligkeit dran; „nur vor Beginn" gilt allein für Termine (runEvents).
  assert.deepEqual(dueLeads('2026-09-15T06:00:00Z', [0], now, LEAD_GRACE_MS), [0]);
});

test('Berliner Tagesfenster, Sommer und Winter', () => {
  assert.deepEqual(berlinDayWindow('2026-09-15'), {
    from: '2026-09-14T22:00:00.000Z',
    to: '2026-09-15T22:00:00.000Z',
  });
  assert.deepEqual(berlinDayWindow('2026-01-10'), {
    from: '2026-01-09T23:00:00.000Z',
    to: '2026-01-10T23:00:00.000Z',
  });
});

test('ein Geburtstags-Fenster ab heute deckt alle Zieltage ab, auch über die Zeitumstellung', () => {
  assert.deepEqual(birthdayWindow('2026-09-15', [0]), berlinDayWindow('2026-09-15'));
  assert.deepEqual(birthdayWindow('2026-09-15', [7, 0, 3]), {
    from: '2026-09-14T22:00:00.000Z',
    to: '2026-09-22T22:00:00.000Z',
  });
  // Ohne „Am Tag" beginnt es trotzdem heute — der Tagesüberblick nutzt es mit.
  assert.deepEqual(birthdayWindow('2026-09-15', [1]), {
    from: '2026-09-14T22:00:00.000Z',
    to: '2026-09-16T22:00:00.000Z',
  });
  assert.deepEqual(birthdayWindow('2026-10-24', [0, 1]), {
    from: '2026-10-23T22:00:00.000Z',
    to: '2026-10-25T23:00:00.000Z',
  });
});

test('Vorlauf-Nachricht nur für eigene Termine mit Uhrzeit ohne ToDo-Spiegel', () => {
  assert.equal(isLeadNotifiable(ev({})), true);
  assert.equal(isLeadNotifiable(ev({ editable: false })), false);
  assert.equal(isLeadNotifiable(ev({ all_day: true, start: '2026-09-15' })), false);
  assert.equal(isLeadNotifiable(ev({ todo_id: 't1' })), false);
  for (const type of ['birthday', 'workingLocation', 'outOfOffice', 'focusTime']) {
    assert.equal(isLeadNotifiable(ev({ event_type: type })), false, type);
  }
  assert.equal(isLeadNotifiable(ev({ event_type: null })), true);
});

test('Termine aus Kalender-Abos bekommen eine Vorlauf-Nachricht, obwohl sie schreibgeschützt sind', () => {
  const sub = { calendar: 'subscription' as const, calendar_id: 'sub:abc', editable: false, event_type: null };
  assert.equal(isLeadNotifiable(ev(sub)), true);
  assert.equal(isLeadNotifiable(ev({ ...sub, all_day: true, start: '2026-09-15' })), false);
  // Fremde Google-Kalender ohne Schreibrecht bleiben still.
  assert.equal(isLeadNotifiable(ev({ calendar: 'primary', editable: false })), false);
});

test('Abo-Termine zählen nicht als Google-Geburtstage', () => {
  const sub = ev({ calendar: 'subscription', calendar_id: 'sub:abc', editable: false, event_type: null, start: '2026-09-15' });
  assert.deepEqual(googleBirthdaysOn([sub], '2026-09-15'), []);
});

test('Termine des Tages: ganztägige zuerst, Spiegel und Geburtstage raus', () => {
  const events = [
    ev({ id: 'late', summary: 'Sport', start: '2026-09-15T18:00:00+02:00' }),
    ev({ id: 'early', summary: 'Vorlesung', start: '2026-09-15T09:00:00+02:00' }),
    ev({ id: 'span', summary: 'Urlaub', all_day: true, start: '2026-09-14', end: '2026-09-17' }),
    ev({ id: 'bday', event_type: 'birthday', all_day: true, start: '2026-09-15', end: '2026-09-16' }),
    ev({ id: 'mirror', todo_id: 't1' }),
    ev({ id: 'wl', event_type: 'workingLocation', all_day: true, start: '2026-09-15', end: '2026-09-16' }),
    ev({ id: 'tomorrow', start: '2026-09-16T00:30:00+02:00' }),
    ev({ id: 'endsToday', all_day: true, start: '2026-09-14', end: '2026-09-15' }),
    ev({ id: 'focus', event_type: 'focusTime', start: '2026-09-15T13:00:00+02:00' }),
  ];
  assert.deepEqual(
    eventsOnDay(events, '2026-09-15').map((e) => e.id),
    ['span', 'early', 'focus', 'late'],
  );
});

test('Google-Geburtstage des Zieltags', () => {
  const events = [
    ev({ summary: 'Anna Musterfrau', event_type: 'birthday', all_day: true, start: '2026-09-15', end: '2026-09-16' }),
    ev({ summary: 'Ben', event_type: 'birthday', all_day: true, start: '2026-09-16', end: '2026-09-17' }),
    ev({ summary: 'Kein Geburtstag', all_day: true, start: '2026-09-15', end: '2026-09-16' }),
  ];
  assert.deepEqual(googleBirthdaysOn(events, '2026-09-15'), ['Anna Musterfrau']);
});

test('Kontaktname und Namensabgleich', () => {
  assert.equal(contactDisplayName(contact({ first_name: 'Anna', last_name: 'Musterfrau' })), 'Anna Musterfrau');
  assert.equal(contactDisplayName(contact({ nickname: 'Benni' })), 'Benni');
  assert.equal(contactDisplayName(contact({})), '(ohne Namen)');

  const anna = contact({ first_name: 'Anna', last_name: 'Musterfrau', nickname: 'Annie' });
  assert.equal(matchesContact('anna musterfrau', anna), true);
  assert.equal(matchesContact('Geburtstag von Anna  Musterfrau', anna), true);
  assert.equal(matchesContact('ANNIE', anna), true);
  assert.equal(matchesContact('Annie Müller', anna), false);
  assert.equal(matchesContact('Anna Musterfrauen', anna), false);
  assert.equal(matchesContact('Annalena', contact({ first_name: 'Anna' })), false);
  assert.equal(matchesContact('Anna', contact({ first_name: 'Anna' })), true);
});

test('Geburtstage: Kontakte mit Alter, Google-Einträge ohne Dubletten', () => {
  const contacts = [
    contact({ first_name: 'Anna', last_name: 'Musterfrau', birthday: '1996-09-15' }),
    contact({ first_name: 'Carla', birthday: '1604-09-15', birthday_year_known: false }),
    contact({ first_name: 'Ben', last_name: 'Mustermann', nickname: 'Benni', birthday: '1990-03-01' }),
  ];
  const people = birthdayPeople(contacts, ['anna musterfrau', 'Benni', 'Dora', 'dora ', ''], '2026-09-15');
  assert.deepEqual(people, [
    { name: 'Anna Musterfrau', age: 30 },
    { name: 'Carla', age: null },
    // Ben hat an diesem Tag laut Kontakt keinen Geburtstag — der Google-Eintrag bleibt.
    { name: 'Benni', age: null },
    { name: 'Dora', age: null },
  ]);
  assert.equal(birthdayPeopleText(people), 'Anna Musterfrau (30), Carla, Benni, Dora');
  assert.deepEqual(birthdayPeople(contacts, [], '2026-09-16'), []);
});

test('Nachrichtentexte', () => {
  assert.equal(shortList(['A', 'B', 'C']), 'A, B, C');
  assert.equal(shortList(['A', 'B', 'C', 'D', 'E', 'F']), 'A, B, C, D +2');
  assert.equal(todosDayBody(['Wäsche', 'Mail']), '2 ToDos: Wäsche, Mail');
  assert.equal(todosDayBody(['Wäsche']), '1 ToDo: Wäsche');
  assert.equal(todoLeadBody('2026-09-15T12:30:00Z', 30), 'Fällig 14:30');
  assert.equal(todoLeadBody('2026-09-15T12:30:00Z', 0), 'Jetzt fällig');
  assert.equal(eventBody('2026-09-15T07:00:00Z', null), '09:00');
  assert.equal(eventBody('2026-09-15T07:00:00Z', 'Raum 1'), '09:00 · Raum 1');
  assert.equal(reminderTodoBody('2026-09-15T12:30:00Z'), 'Fällig 14:30');
  assert.equal(reminderTodoBody('2026-09-15T00:00:00Z'), 'Erinnerung');
  assert.equal(reminderTodoBody(null), 'Erinnerung');

  const lw = learnwebBody('ML', '2026-09-16T21:59:00Z');
  assert.ok(lw.startsWith('ML · fällig 16.'), lw);
  assert.ok(lw.endsWith('23:59'), lw);
  assert.ok(learnwebBody(null, '2026-09-16T21:59:00Z').startsWith('Fällig 16.'));
});

test('Tagesüberblick', () => {
  const day = eventsOnDay(
    [
      ev({ summary: 'Vorlesung', start: '2026-09-15T09:00:00+02:00' }),
      ev({ summary: 'Sport', start: '2026-09-15T18:00:00+02:00' }),
      ev({ summary: 'Urlaub', all_day: true, start: '2026-09-15', end: '2026-09-16' }),
    ],
    '2026-09-15',
  );
  assert.equal(
    digestBody({ events: day, todoCount: 2, birthdayNames: ['Anna'] }),
    '3 Termine, erster 09:00 Vorlesung · 2 ToDos fällig · 🎂 Anna',
  );
  assert.equal(digestBody({ events: [], todoCount: 0, birthdayNames: [] }), 'Heute steht nichts an.');
  assert.equal(digestBody({ events: [], calendarFailed: true, todoCount: 0, birthdayNames: [] }), 'Termine nicht lesbar');
  assert.equal(
    digestBody({ events: [], calendarFailed: true, todoCount: 2, birthdayNames: ['Anna'] }),
    'Termine nicht lesbar · 2 ToDos fällig · 🎂 Anna',
  );
  assert.equal(
    digestBody({ events: [ev({ summary: 'Vorlesung' })], calendarIncomplete: true, todoCount: 0, birthdayNames: [] }),
    'Termine teils nicht lesbar · 1 Termin: 09:00 Vorlesung',
  );
  assert.equal(
    digestBody({ events: [ev({ summary: 'Vorlesung' })], todoCount: 1, birthdayNames: [] }),
    '1 Termin: 09:00 Vorlesung · 1 ToDo fällig',
  );
  assert.equal(
    digestBody({
      events: [ev({ summary: 'Urlaub', all_day: true, start: '2026-09-15', end: '2026-09-16' })],
      todoCount: 0,
      birthdayNames: ['A', 'B', 'C', 'D'],
    }),
    '1 Termin: Urlaub · 🎂 A, B, C +1',
  );
});
