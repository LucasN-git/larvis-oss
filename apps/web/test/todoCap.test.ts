import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capRows, HOME_TODO_CAP } from '../src/features/todos/cap';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

test('capRows: leere Liste', () => {
  assert.deepEqual(capRows([], HOME_TODO_CAP), { visible: [], hidden: 0 });
});

test('capRows: genau an der Grenze bleibt alles sichtbar', () => {
  const r = capRows(rows(25), HOME_TODO_CAP);
  assert.equal(r.visible.length, 25);
  assert.equal(r.hidden, 0);
});

test('capRows: über der Grenze wird abgeschnitten', () => {
  const r = capRows(rows(30), HOME_TODO_CAP);
  assert.deepEqual(r.visible, rows(25));
  assert.equal(r.hidden, 5);
});

test('capRows: ohne Grenze bleibt die Liste ganz', () => {
  const r = capRows(rows(30));
  assert.equal(r.visible.length, 30);
  assert.equal(r.hidden, 0);
});

test('capRows: Grenze 0 versteckt alles', () => {
  assert.deepEqual(capRows(rows(3), 0), { visible: [], hidden: 3 });
});
