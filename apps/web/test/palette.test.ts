import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_PALETTE, firstUnusedPaletteColor } from '@larvis/shared';

test('palette hexes are unique uppercase #RRGGBB', () => {
  for (const c of PROJECT_PALETTE) assert.match(c.hex, /^#[0-9A-F]{6}$/);
  assert.equal(new Set(PROJECT_PALETTE.map((c) => c.hex)).size, PROJECT_PALETTE.length);
});

test('first unused colour among top-level projects', () => {
  assert.equal(firstUnusedPaletteColor([]), PROJECT_PALETTE[0]!.hex);
  const projects = [
    { parent_id: null, color: PROJECT_PALETTE[0]!.hex.toLowerCase() },
    { parent_id: null, color: PROJECT_PALETTE[2]!.hex },
    // Unterprojekte zählen nicht.
    { parent_id: 'x', color: PROJECT_PALETTE[1]!.hex },
    { parent_id: null, color: null },
  ];
  assert.equal(firstUnusedPaletteColor(projects), PROJECT_PALETTE[1]!.hex);
});

test('wraps to the first colour when all are used', () => {
  const all = PROJECT_PALETTE.map((c) => ({ parent_id: null, color: c.hex }));
  assert.equal(firstUnusedPaletteColor(all), PROJECT_PALETTE[0]!.hex);
});
