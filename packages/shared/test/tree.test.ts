import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, descendantIds, flattenTree, pathTo } from '../src/tree.js';

const items = [
  { id: 'a', parent_id: null, sort_order: 2, title: 'A' },
  { id: 'b', parent_id: null, sort_order: 1, title: 'B' },
  { id: 'a1', parent_id: 'a', sort_order: 0, title: 'Zwei' },
  { id: 'a2', parent_id: 'a', sort_order: 0, title: 'Eins' },
  { id: 'a1x', parent_id: 'a1', sort_order: 0, title: 'Tief' },
  { id: 'orphan', parent_id: 'missing', sort_order: 0, title: 'Waise' },
];

test('buildTree nests by parent_id, sorts siblings by sort_order then title, and makes orphans roots', () => {
  const tree = buildTree(items);
  assert.deepEqual(tree.map((n) => n.id), ['orphan', 'b', 'a']);
  const a = tree[2];
  assert.deepEqual(a.children.map((n) => n.title), ['Eins', 'Zwei']);
  assert.equal(a.children[1].children[0].id, 'a1x');
});

test('flattenTree yields depth-first order with depths', () => {
  const flat = flattenTree(buildTree(items)).map(({ node, depth }) => `${depth}:${node.id}`);
  assert.deepEqual(flat, ['0:orphan', '0:b', '0:a', '1:a2', '1:a1', '2:a1x']);
});

test('descendantIds collects the whole subtree, never the root itself', () => {
  assert.deepEqual([...descendantIds(items, 'a')].sort(), ['a1', 'a1x', 'a2']);
  assert.equal(descendantIds(items, 'a1x').size, 0);
});

test('pathTo walks from the root down to the item, empty for unknown ids', () => {
  assert.deepEqual(pathTo(items, 'a1x').map((i) => i.id), ['a', 'a1', 'a1x']);
  assert.deepEqual(pathTo(items, 'orphan').map((i) => i.id), ['orphan']);
  assert.deepEqual(pathTo(items, 'nope'), []);
});
