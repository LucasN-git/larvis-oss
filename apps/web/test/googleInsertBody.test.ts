import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGoogleInsertBody } from '../api/_lib/google.js';

const base = { summary: 'Termin', all_day: false, start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T11:00:00.000Z' };

test('Neuer Termin ohne Projekt, Tags und Ort schickt keine null-Schlüssel an Google', () => {
  const body = toGoogleInsertBody({ ...base, project_id: null, tags: [], place_id: null });
  assert.equal(body.extendedProperties, undefined);
  assert.deepEqual(body.start, { dateTime: base.start });
});

test('Gesetzte Larvis-Felder bleiben beim Anlegen erhalten, leere fallen weg', () => {
  const body = toGoogleInsertBody({ ...base, project_id: 'p1', tags: [], place_id: null });
  assert.deepEqual(body.extendedProperties, { private: { larvis_project_id: 'p1' } });
});
