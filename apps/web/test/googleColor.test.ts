import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_PALETTE, effectiveProjectColor as sharedEffective } from '@larvis/shared';
import { PALETTE_GOOGLE_COLOR, hexToGoogleColorId } from '../api/_lib/calendar.js';
import { effectiveProjectColor } from '../api/_lib/google.js';

test('Palettenfarben bekommen ihre feste Google-colorId, unabhängig von Groß-/Kleinschreibung', () => {
  assert.equal(hexToGoogleColorId('#0A8CFF'), '7');
  assert.equal(hexToGoogleColorId('#e0571f'), '11');
  assert.equal(hexToGoogleColorId(' #8B919A '), '8');
});

test('die Kopie der Palette in api/ stimmt mit PROJECT_PALETTE überein', () => {
  const fromShared = Object.fromEntries(PROJECT_PALETTE.map((c) => [c.hex.toLowerCase(), c.googleColorId]));
  assert.deepEqual(PALETTE_GOOGLE_COLOR, fromShared);
});

test('Farben außerhalb der Palette fallen auf die nächste Google-Farbe zurück', () => {
  assert.equal(hexToGoogleColorId('#d50001'), '11');
  assert.equal(hexToGoogleColorId('kaputt'), null);
  assert.equal(hexToGoogleColorId(null), null);
});

const projects = [
  { id: 'root', parent_id: null, color: '#2F55C6' },
  { id: 'mid', parent_id: 'root', color: null },
  { id: 'leaf', parent_id: 'mid', color: null },
  { id: 'own', parent_id: 'root', color: '#8B5CF6' },
  { id: 'bare', parent_id: null, color: null },
  { id: 'cycA', parent_id: 'cycB', color: null },
  { id: 'cycB', parent_id: 'cycA', color: null },
];

test('Unterprojekt ohne eigene Farbe erbt über die Elternkette', () => {
  assert.equal(effectiveProjectColor(projects, 'leaf'), '#2F55C6');
  assert.equal(effectiveProjectColor(projects, 'mid'), '#2F55C6');
  assert.equal(effectiveProjectColor(projects, 'own'), '#8B5CF6');
});

test('ohne Farbe in der Kette, unbekannte id oder Zyklus → null', () => {
  assert.equal(effectiveProjectColor(projects, 'bare'), null);
  assert.equal(effectiveProjectColor(projects, 'gibtsnicht'), null);
  assert.equal(effectiveProjectColor(projects, null), null);
  assert.equal(effectiveProjectColor(projects, 'cycA'), null);
});

test('die Kopie in api/ verhält sich wie effectiveProjectColor aus shared', () => {
  for (const p of [...projects.map((x) => x.id), 'gibtsnicht']) {
    assert.equal(effectiveProjectColor(projects, p), sharedEffective(projects, p), p);
  }
});
