import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveProjectColor, projectColorMap, PROJECT_PALETTE } from '../src/projects.js';
import { hexToGoogleColorId } from '../src/calendar.js';

const projects = [
  { id: 'root', parent_id: null, color: '#14B8A6' },
  { id: 'child', parent_id: 'root', color: null },
  { id: 'grandchild', parent_id: 'child', color: null },
  { id: 'own', parent_id: 'root', color: '#8B5CF6' },
  { id: 'bare', parent_id: null, color: null },
  { id: 'bareChild', parent_id: 'bare', color: null },
  { id: 'cycA', parent_id: 'cycB', color: null },
  { id: 'cycB', parent_id: 'cycA', color: null },
];

test('effectiveProjectColor: own colour wins over the parent', () => {
  assert.equal(effectiveProjectColor(projects, 'own'), '#8B5CF6');
  assert.equal(effectiveProjectColor(projects, 'root'), '#14B8A6');
});

test('effectiveProjectColor: inherits from parent and grandparent', () => {
  assert.equal(effectiveProjectColor(projects, 'child'), '#14B8A6');
  assert.equal(effectiveProjectColor(projects, 'grandchild'), '#14B8A6');
});

test('effectiveProjectColor: chain without any colour → null', () => {
  assert.equal(effectiveProjectColor(projects, 'bareChild'), null);
});

test('effectiveProjectColor: cycles terminate with null', () => {
  assert.equal(effectiveProjectColor(projects, 'cycA'), null);
});

test('effectiveProjectColor: unknown, null or undefined id → null', () => {
  assert.equal(effectiveProjectColor(projects, 'nope'), null);
  assert.equal(effectiveProjectColor(projects, null), null);
  assert.equal(effectiveProjectColor(projects, undefined), null);
});

test('projectColorMap resolves inherited colours for every project', () => {
  const m = projectColorMap(projects);
  assert.equal(m.size, projects.length);
  assert.equal(m.get('grandchild'), '#14B8A6');
  assert.equal(m.get('own'), '#8B5CF6');
  assert.equal(m.get('cycB'), null);
});

test('PROJECT_PALETTE hexes are unique uppercase #RRGGBB', () => {
  const hexes = PROJECT_PALETTE.map((c) => c.hex);
  assert.equal(new Set(hexes).size, hexes.length);
  for (const h of hexes) assert.match(h, /^#[0-9A-F]{6}$/);
});

test('hexToGoogleColorId maps palette colours to their fixed googleColorId (case-insensitive)', () => {
  for (const c of PROJECT_PALETTE) {
    assert.equal(hexToGoogleColorId(c.hex), c.googleColorId);
    assert.equal(hexToGoogleColorId(c.hex.toLowerCase()), c.googleColorId);
  }
});

test('hexToGoogleColorId still maps a non-palette hex to the nearest Google colour', () => {
  assert.equal(hexToGoogleColorId('#d40000'), '11'); // nahe Tomato
  assert.equal(hexToGoogleColorId('#3f51b6'), '9'); // nahe Blueberry
  assert.equal(hexToGoogleColorId('kein hex'), null);
});
