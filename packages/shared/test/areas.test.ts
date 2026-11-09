import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREA_MAX_LENGTH, collectAreas, entryInArea, normalizeArea, normalizeAreas } from '../src/types.js';

test('normalizeArea: klein, getrimmt, einfache Leerzeichen, begrenzt', () => {
  assert.equal(normalizeArea('  Kochen  '), 'kochen');
  assert.equal(normalizeArea('Reisen   und\tEssen'), 'reisen und essen');
  assert.equal(normalizeArea('   '), '');
  assert.equal(normalizeArea('x'.repeat(AREA_MAX_LENGTH + 10)).length, AREA_MAX_LENGTH);
});

test('normalizeAreas: ohne Leere, Dubletten und Hauptbereich', () => {
  assert.deepEqual(normalizeAreas(['Reisen', 'reisen ', '', 'Kochen', 'garten'], 'kochen'), ['reisen', 'garten']);
  assert.deepEqual(normalizeAreas([]), []);
});

test('collectAreas: Haupt- und weitere Bereiche, häufigste zuerst', () => {
  const rows = [
    { area: 'kochen', also_areas: ['reisen'] },
    { area: 'reisen', also_areas: [] },
    { area: 'garten' },
    { area: 'reisen', also_areas: ['reisen'] },
  ];
  assert.deepEqual(collectAreas(rows), [
    { area: 'reisen', count: 3 },
    { area: 'garten', count: 1 },
    { area: 'kochen', count: 1 },
  ]);
  assert.deepEqual(collectAreas([]), []);
});

test('entryInArea trifft Haupt- und weiteren Bereich', () => {
  const e = { area: 'kochen', also_areas: ['reisen'] };
  assert.equal(entryInArea(e, 'kochen'), true);
  assert.equal(entryInArea(e, 'reisen'), true);
  assert.equal(entryInArea(e, 'garten'), false);
});
