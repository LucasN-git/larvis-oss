import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  expandIcs,
  fetchIcs,
  IcsError,
  cleanSubscriptionProjectId,
  listSubscriptionEvents,
  lookupSubscriptionEvent,
  maskIcsUrl,
  normalizeIcsUrl,
  parseIcs,
  resolveIanaZone,
  updateCalendarSubscription,
} from '../src/ics/index.js';

const fixture = (name: string) => readFileSync(new URL(`./ics/${name}`, import.meta.url), 'utf8');
const SUB = { id: 'abc', name: 'Outlook', color: '#0078d4' };
const WINDOW = ['2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'] as const;

test('Outlook: Windows-TZID, RRULE, EXDATE, verschobene Instanzen, ganztägig, abgesagt', () => {
  // Outlook liefert CRLF; ical.js muss beides lesen.
  const cal = parseIcs(fixture('outlook.ics').replace(/\n/g, '\r\n'));
  assert.equal(cal.name, 'Kalender');
  const events = expandIcs(cal, SUB, ...WINDOW);
  const brief = events.map((e) => [e.summary, e.start, e.end]);
  assert.deepEqual(brief, [
    ['Jour fixe', '2026-10-05T08:00:00.000Z', '2026-10-05T08:30:00.000Z'],
    // Pacific Standard Time ohne VTIMEZONE im Feed → America/Los_Angeles (PDT, UTC−7).
    ['Call mit Seattle', '2026-10-07T16:00:00.000Z', '2026-10-07T17:00:00.000Z'],
    // 12.10. per EXDATE gestrichen; 19.10. auf 14 Uhr verschoben.
    ['Jour fixe (verschoben)', '2026-10-19T12:00:00.000Z', '2026-10-19T12:30:00.000Z'],
    ['Messe', '2026-10-21', '2026-10-22'],
    // Nach der Zeitumstellung am 25.10. liegt 10 Uhr bei 09:00 UTC.
    ['Jour fixe', '2026-10-26T09:00:00.000Z', '2026-10-26T09:30:00.000Z'],
    // Instanz vom 9.11. ins Fenster vorgezogen.
    ['Jour fixe (vorgezogen)', '2026-10-30T09:00:00.000Z', '2026-10-30T09:30:00.000Z'],
  ]);
  for (const e of events) {
    assert.equal(e.calendar, 'subscription');
    assert.equal(e.calendar_id, 'sub:abc');
    assert.equal(e.calendar_name, 'Outlook');
    assert.equal(e.color, '#0078d4');
    assert.equal(e.editable, false);
    assert.equal(e.project_id, null);
    assert.deepEqual(e.tags, []);
    assert.equal(e.todo_id, null);
    assert.ok(e.id.startsWith('sub:abc:'));
  }
  const messe = events.find((e) => e.summary === 'Messe')!;
  assert.equal(messe.all_day, true);
  assert.equal(messe.recurring_event_id, null);
  const series = events.filter((e) => e.summary.startsWith('Jour fixe'));
  assert.equal(new Set(series.map((e) => e.recurring_event_id)).size, 1);
  assert.ok(series[0].recurring_event_id);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length, 'ids sind eindeutig');
});

test('ids bleiben zwischen zwei Abrufen und über verschiedene Fenster gleich', () => {
  const a = expandIcs(parseIcs(fixture('outlook.ics')), SUB, ...WINDOW);
  const b = expandIcs(parseIcs(fixture('outlook.ics')), SUB, '2026-10-26T00:00:00Z', '2026-12-01T00:00:00Z');
  const idA = a.find((e) => e.start === '2026-10-26T09:00:00.000Z')!.id;
  const idB = b.find((e) => e.start === '2026-10-26T09:00:00.000Z')!.id;
  assert.equal(idA, idB);
  // Hinter dem ersten Fenster: 2.11., 9.11. ist vorgezogen (liegt vor dem Fenster).
  assert.deepEqual(
    b.map((e) => e.start),
    ['2026-10-26T09:00:00.000Z', '2026-10-30T09:00:00.000Z', '2026-11-02T09:00:00.000Z'],
  );
});

test('Google: IANA-TZID über die Zeitumstellung, abgesagte Instanz, UTC, mehrtägig, ohne Zeitzone', () => {
  const cal = parseIcs(fixture('google.ics'));
  const events = expandIcs(cal, { ...SUB, name: 'Arbeit' }, ...WINDOW);
  assert.deepEqual(
    events.map((e) => [e.summary, e.start, e.end, e.all_day]),
    [
      ['Laufen', '2026-10-24T07:00:00.000Z', '2026-10-24T08:00:00.000Z', false],
      // 25.10. abgesagt (STATUS:CANCELLED an der Instanz); 26.10. schon Winterzeit.
      ['Laufen', '2026-10-26T08:00:00.000Z', '2026-10-26T09:00:00.000Z', false],
      ['Kundentermin', '2026-10-27T12:00:00.000Z', '2026-10-27T13:00:00.000Z', false],
      ['Urlaub', '2026-10-28', '2026-10-31', true],
      // Ohne TZID gilt X-WR-TIMEZONE (Europe/Berlin, CET).
      ['Ohne Zeitzone', '2026-10-29T17:00:00.000Z', '2026-10-29T18:00:00.000Z', false],
    ],
  );
  const kunde = events.find((e) => e.summary === 'Kundentermin')!;
  assert.equal(kunde.description, 'Agenda:\nPunkt 1, Punkt 2');
  assert.equal(kunde.location, 'Beispielstadt');
  assert.equal(kunde.html_link, 'https://example.com/termin');
});

test('parseIcs weist Nicht-Kalender mit verständlicher Meldung ab', () => {
  assert.throws(() => parseIcs('<!doctype html><html></html>'), IcsError);
  assert.throws(() => parseIcs(''), /kein Kalender/);
});

test('normalizeIcsUrl: webcal → https, nur http(s), keine internen Adressen', () => {
  assert.equal(
    normalizeIcsUrl(' webcal://outlook.office365.com/owa/calendar/x/y/calendar.ics '),
    'https://outlook.office365.com/owa/calendar/x/y/calendar.ics',
  );
  assert.throws(() => normalizeIcsUrl('ftp://example.com/a.ics'), IcsError);
  assert.throws(() => normalizeIcsUrl('kein link'), IcsError);
  assert.throws(() => normalizeIcsUrl(''), IcsError);
  for (const internal of [
    'http://localhost:3000/a.ics',
    'http://127.0.0.1/a.ics',
    'http://10.0.0.5/a.ics',
    'http://kong:8000/a',
    'http://[::1]/a',
    'http://169.254.169.254/latest',
    'http://172.20.0.3/a',
    'http://[fd00::1]/a',
    'http://[::ffff:127.0.0.1]/a',
    'http://localhost./a',
  ]) {
    assert.throws(() => normalizeIcsUrl(internal), /interne Adresse/, internal);
  }
});

test('maskIcsUrl zeigt nur Host und unverfängliches Ende', () => {
  assert.equal(
    maskIcsUrl('https://calendar.google.com/calendar/ical/max%40example.com/private-0123456789abcdef0123/basic.ics'),
    'calendar.google.com/…/basic.ics',
  );
  assert.equal(
    maskIcsUrl('https://example.com/feed/3f9a2b7c4d5e6f708192a3b4c5d6e7f8'),
    'example.com/…/…e7f8',
  );
  assert.ok(!maskIcsUrl('https://h.example/x/private-secret123456/a.ics').includes('secret'));
});

test('resolveIanaZone versteht Windows-, IANA- und Präfix-Namen', () => {
  assert.equal(resolveIanaZone('W. Europe Standard Time'), 'Europe/Berlin');
  assert.equal(resolveIanaZone('Europe/Berlin'), 'Europe/Berlin');
  assert.equal(resolveIanaZone('/freeassociation.sourceforge.net/Tzfile/Europe/Berlin'), 'Europe/Berlin');
  assert.equal(resolveIanaZone('(UTC+01:00) Amsterdam, Berlin'), null);
});

test('unbekannter TZID-Name fällt auf die VTIMEZONE aus dem Feed zurück', () => {
  const tz = '(UTC-05:00) Bogota, Lima, Quito';
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VTIMEZONE',
    `TZID:${tz}`,
    'BEGIN:STANDARD',
    'DTSTART:16010101T000000',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0500',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:x1',
    'SUMMARY:Sommer',
    `DTSTART;TZID="${tz}":20260710T120000`,
    `DTEND;TZID="${tz}":20260710T130000`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const [ev] = expandIcs(parseIcs(ics), SUB, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z');
  assert.equal(ev.start, '2026-07-10T17:00:00.000Z');
  assert.equal(ev.end, '2026-07-10T18:00:00.000Z');
});

test('alte Tagesserie: nur das Fenster wird ausgerechnet, Ausnahmen vor und im Fenster stimmen', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:daily',
    'SUMMARY:Täglich',
    'DTSTART;TZID=Europe/Berlin:20100104T090000',
    'DTEND;TZID=Europe/Berlin:20100104T093000',
    'RRULE:FREQ=DAILY',
    'END:VEVENT',
    // Instanz von 2010 in das Fenster verschoben.
    'BEGIN:VEVENT',
    'UID:daily',
    'SUMMARY:Aus 2010',
    'RECURRENCE-ID;TZID=Europe/Berlin:20100105T090000',
    'DTSTART;TZID=Europe/Berlin:20261007T150000',
    'DTEND;TZID=Europe/Berlin:20261007T160000',
    'END:VEVENT',
    // Instanz im Fenster aus dem Fenster verschoben.
    'BEGIN:VEVENT',
    'UID:daily',
    'SUMMARY:Weg',
    'RECURRENCE-ID;TZID=Europe/Berlin:20261008T090000',
    'DTSTART;TZID=Europe/Berlin:20261201T090000',
    'DTEND;TZID=Europe/Berlin:20261201T093000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const cal = parseIcs(ics);
  const t0 = performance.now();
  const events = expandIcs(cal, SUB, '2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z');
  assert.ok(performance.now() - t0 < 500, 'Ausrechnen bleibt schnell');
  assert.deepEqual(
    events.map((e) => [e.summary, e.start]),
    [
      ['Täglich', '2026-10-05T07:00:00.000Z'],
      ['Täglich', '2026-10-06T07:00:00.000Z'],
      ['Täglich', '2026-10-07T07:00:00.000Z'],
      ['Aus 2010', '2026-10-07T13:00:00.000Z'],
      ['Täglich', '2026-10-09T07:00:00.000Z'],
      ['Täglich', '2026-10-10T07:00:00.000Z'],
      ['Täglich', '2026-10-11T07:00:00.000Z'],
    ],
  );
});

async function withFetch(stub: (url: string) => Response, run: (calls: string[]) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return stub(url);
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('fetchIcs: Weiterleitung auf interne Adresse wird nicht abgerufen', async () => {
  await withFetch(
    () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/x' } }),
    async (calls) => {
      await assert.rejects(fetchIcs('https://example.com/a.ics'), /interne Adresse/);
      assert.equal(calls.length, 1);
    },
  );
});

test('fetchIcs: Antwort über 15 MB ohne Content-Length bricht ab', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  await withFetch(
    () =>
      new Response(
        new ReadableStream({
          pull(ctrl) {
            if (sent++ < 20) ctrl.enqueue(chunk);
            else ctrl.close();
          },
        }),
      ),
    async () => {
      await assert.rejects(fetchIcs('https://example.com/a.ics'), /zu groß/);
    },
  );
});

test('fetchIcs: Fehlermeldung bei 404 nennt den Link nicht', async () => {
  const url = 'https://example.com/private-geheim123456/calendar.ics';
  await withFetch(
    () => new Response('not found', { status: 404 }),
    async () => {
      await assert.rejects(fetchIcs(url), (e: unknown) => {
        assert.ok(e instanceof IcsError);
        assert.ok(!e.message.includes(url) && !e.message.includes('geheim'), e.message);
        return true;
      });
    },
  );
});

test('Abo: gescheiterter Neuabruf liefert den letzten guten Stand samt Fehler, ohne last_synced_at', async () => {
  const row = {
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Google',
    color: '#0f9d58',
    url: 'https://example.com/stale.ics',
    enabled: true,
    last_error: null as string | null,
    last_synced_at: null,
    created_at: '2026-10-01T00:00:00Z',
    deleted_at: null,
  };
  const updates: Record<string, unknown>[] = [];
  // Minimaler Supabase-Ersatz: select-Kette liefert die Zeile, update-Kette merkt sich den Patch.
  const chain = (result: unknown): unknown =>
    new Proxy(() => {}, {
      get: (_t, prop) =>
        prop === 'then'
          ? (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, fail)
          : () => chain(result),
    });
  const db = {
    from: () => ({
      select: () => chain({ data: [row], error: null }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return chain({ data: null, error: null });
      },
    }),
  } as unknown as Parameters<typeof listSubscriptionEvents>[0];

  let now = Date.parse('2026-10-12T10:00:00Z');
  const clock = mock.method(Date, 'now', () => now);
  let ok = true;
  try {
    await withFetch(
      () => (ok ? new Response(fixture('google.ics')) : new Response('kaputt', { status: 503 })),
      async (calls) => {
        const first = await listSubscriptionEvents(db, ...WINDOW);
        assert.ok(first.events.length > 0);
        assert.deepEqual(first.errors, []);
        assert.equal(updates.length, 1);
        assert.ok(updates[0].last_synced_at);

        ok = false;
        now += 6 * 60_000;
        const stale = await listSubscriptionEvents(db, ...WINDOW);
        assert.equal(calls.length, 2);
        assert.deepEqual(stale.events, first.events);
        assert.equal(stale.errors.length, 1);
        assert.match(stale.errors[0].error, /HTTP 503/);
        assert.equal(stale.errors[0].stale, true);
        assert.equal(updates.length, 2);
        assert.deepEqual(Object.keys(updates[1]), ['last_error']);

        // Innerhalb der Fehler-Minute kein neuer Abruf, danach schon.
        row.last_error = stale.errors[0].error;
        now += 30_000;
        const cached = await listSubscriptionEvents(db, ...WINDOW);
        assert.equal(calls.length, 2);
        assert.deepEqual(cached.events, first.events);
        assert.equal(cached.errors.length, 1);
        now += 31_000;
        await listSubscriptionEvents(db, ...WINDOW);
        assert.equal(calls.length, 3);
      },
    );
  } finally {
    clock.mock.restore();
  }
});

/** Minimaler Supabase-Ersatz: jede Kette endet in `result`. */
const chainOf = (result: unknown): unknown =>
  new Proxy(() => {}, {
    get: (_t, prop) =>
      prop === 'then'
        ? (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, fail)
        : () => chainOf(result),
  });
type Db = Parameters<typeof listSubscriptionEvents>[0];

test('Abo-Tabelle nicht lesbar: listError statt stiller null Abos', async () => {
  const db = { from: () => ({ select: () => chainOf({ data: null, error: { message: 'relation does not exist' } }) }) } as unknown as Db;
  const res = await listSubscriptionEvents(db, ...WINDOW);
  assert.deepEqual(res.events, []);
  assert.equal(res.subscriptions, 0);
  assert.match(res.listError ?? '', /relation does not exist/);
});

test('lookupSubscriptionEvent: gefunden, verschoben, unbekannt, Abo aus, Feed ohne Stand', async () => {
  const row = {
    id: '22222222-3333-4444-5555-666666666666',
    name: 'Arbeit',
    color: '#0f9d58',
    url: 'https://example.com/lookup.ics',
    enabled: true,
    last_error: null,
    last_synced_at: null,
    created_at: '2026-10-01T00:00:00Z',
    deleted_at: null,
  };
  const db = { from: () => ({ select: () => chainOf({ data: row, error: null }) }) } as unknown as Db;
  const calId = `sub:${row.id}`;
  const ev = expandIcs(parseIcs(fixture('google.ics')), row, ...WINDOW).find((e) => !e.all_day)!;
  await withFetch(
    () => new Response(fixture('google.ics')),
    async () => {
      assert.deepEqual(await lookupSubscriptionEvent(db, calId, ev.id, ev.start), { status: 'found', summary: ev.summary });
      const later = new Date(Date.parse(ev.start) + 3_600_000).toISOString();
      assert.deepEqual(await lookupSubscriptionEvent(db, calId, ev.id, later), { status: 'gone' });
      assert.deepEqual(await lookupSubscriptionEvent(db, calId, `${calId}:unbekannt`, ev.start), { status: 'gone' });
    },
  );
  row.enabled = false;
  assert.deepEqual(await lookupSubscriptionEvent(db, calId, ev.id, ev.start), { status: 'gone' });

  const broken = { ...row, id: '33333333-4444-5555-6666-777777777777', url: 'https://example.com/broken.ics', enabled: true };
  const brokenDb = { from: () => ({ select: () => chainOf({ data: broken, error: null }) }) } as unknown as Db;
  await withFetch(
    () => new Response('kaputt', { status: 503 }),
    async () => {
      const res = await lookupSubscriptionEvent(brokenDb, `sub:${broken.id}`, ev.id, ev.start);
      assert.equal(res.status, 'unreadable');
    },
  );
});

test('Abo mit Projekt: jeder Termin trägt die project_id des Abos, ohne Projekt null', () => {
  const cal = parseIcs(fixture('google.ics'));
  const projectId = '99999999-8888-7777-6666-555555555555';
  const withProject = expandIcs(cal, { ...SUB, project_id: projectId }, ...WINDOW);
  assert.ok(withProject.length > 0);
  for (const e of withProject) {
    assert.equal(e.project_id, projectId);
    // Die eigene Abo-Farbe bleibt am Termin; die Projektfarbe leitet die Oberfläche ab.
    assert.equal(e.color, SUB.color);
  }
  for (const e of expandIcs(cal, SUB, ...WINDOW)) assert.equal(e.project_id, null);
});

test('listSubscriptionEvents: Termine eines Abos mit Projekt tragen dessen project_id', async () => {
  const row = {
    id: '44444444-5555-6666-7777-888888888888',
    name: 'Arbeit',
    color: '#0f9d58',
    url: 'https://example.com/projekt.ics',
    enabled: true,
    project_id: '99999999-8888-7777-6666-555555555555',
    last_error: null,
    last_synced_at: null,
    created_at: '2026-10-01T00:00:00Z',
    deleted_at: null,
  };
  const db = {
    from: () => ({ select: () => chainOf({ data: [row], error: null }), update: () => chainOf({ data: null, error: null }) }),
  } as unknown as Db;
  await withFetch(
    () => new Response(fixture('google.ics')),
    async () => {
      const res = await listSubscriptionEvents(db, ...WINDOW);
      assert.ok(res.events.length > 0);
      assert.ok(res.events.every((e) => e.project_id === row.project_id));
    },
  );
});

test('listSubscriptionEvents: geändertes Projekt greift sofort, auch aus dem Feed-Cache', async () => {
  const row = {
    id: '55555555-6666-7777-8888-999999999999',
    name: 'Wechsel',
    color: '#0f9d58',
    url: 'https://example.com/projektwechsel.ics',
    enabled: true,
    project_id: '99999999-8888-7777-6666-555555555555' as string | null,
    last_error: null,
    last_synced_at: null,
    created_at: '2026-10-01T00:00:00Z',
    deleted_at: null,
  };
  const db = {
    from: () => ({ select: () => chainOf({ data: [{ ...row }], error: null }), update: () => chainOf({ data: null, error: null }) }),
  } as unknown as Db;
  await withFetch(
    () => new Response(fixture('google.ics')),
    async (calls) => {
      const first = await listSubscriptionEvents(db, ...WINDOW);
      assert.ok(first.events.length > 0);
      assert.ok(first.events.every((e) => e.project_id === '99999999-8888-7777-6666-555555555555'));

      row.project_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const moved = await listSubscriptionEvents(db, ...WINDOW);
      assert.ok(moved.events.length > 0);
      assert.ok(moved.events.every((e) => e.project_id === row.project_id));

      row.project_id = null;
      const cleared = await listSubscriptionEvents(db, ...WINDOW);
      assert.ok(cleared.events.length > 0);
      assert.ok(cleared.events.every((e) => e.project_id === null));
      assert.equal(calls.length, 1);
    },
  );
});

test('cleanSubscriptionProjectId: null/leer löst, sonst nur bestehende, nicht gelöschte Projekte', async () => {
  const known = '99999999-8888-7777-6666-555555555555';
  const filters: [string, unknown][] = [];
  // Ersatz für projects: select('id').eq('id', …).is('deleted_at', null).maybeSingle()
  const db = {
    from: (table: string) => {
      assert.equal(table, 'projects');
      let id: unknown;
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          filters.push([col, v]);
          if (col === 'id') id = v;
          return q;
        },
        is: (col: string, v: unknown) => {
          filters.push([col, v]);
          return q;
        },
        maybeSingle: async () => ({ data: id === known ? { id } : null, error: null }),
      };
      return q;
    },
  } as unknown as Db;

  assert.equal(await cleanSubscriptionProjectId(db, null), null);
  assert.equal(await cleanSubscriptionProjectId(db, ''), null);
  assert.equal(filters.length, 0);
  await assert.rejects(cleanSubscriptionProjectId(db, 'kein-projekt'), (e) => e instanceof IcsError && /Projekt/.test(e.message));
  await assert.rejects(cleanSubscriptionProjectId(db, 42), IcsError);
  await assert.rejects(
    cleanSubscriptionProjectId(db, '11111111-1111-1111-1111-111111111111'),
    (e) => e instanceof IcsError && /gibt es nicht/.test(e.message),
  );
  assert.equal(await cleanSubscriptionProjectId(db, known), known);
  // Gelöschte Projekte zählen nicht.
  assert.deepEqual(filters.slice(-2), [
    ['id', known],
    ['deleted_at', null],
  ]);
});

test('updateCalendarSubscription: Projekt zuordnen und lösen landet als project_id im Update', async () => {
  const known = '99999999-8888-7777-6666-555555555555';
  const subId = '55555555-6666-7777-8888-999999999999';
  const updates: Record<string, unknown>[] = [];
  const row = {
    id: subId,
    name: 'Arbeit',
    color: '#0f9d58',
    url: 'https://example.com/x.ics',
    enabled: true,
    project_id: null as string | null,
    last_error: null,
    last_synced_at: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    deleted_at: null,
  };
  const db = {
    from: (table: string) =>
      table === 'projects'
        ? { select: () => chainOf({ data: { id: known }, error: null }) }
        : {
            update: (patch: Record<string, unknown>) => {
              updates.push(patch);
              Object.assign(row, patch);
              return chainOf({ data: { ...row }, error: null });
            },
          },
  } as unknown as Db;

  const assigned = await updateCalendarSubscription(db, subId, { project_id: known });
  assert.deepEqual(updates[0], { project_id: known });
  assert.equal(assigned.project_id, known);
  // Die eigene Farbe bleibt unangetastet, damit sie nach dem Lösen wieder gilt.
  assert.equal(assigned.color, '#0f9d58');

  const released = await updateCalendarSubscription(db, subId, { project_id: null });
  assert.deepEqual(updates[1], { project_id: null });
  assert.equal(released.project_id, null);
  assert.equal(released.color, '#0f9d58');
});
