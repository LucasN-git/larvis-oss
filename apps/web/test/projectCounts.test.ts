import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countBySubtree, subtreeIds } from '../src/features/projects/counts';

const projects = [
  { id: 'persoenlich', parent_id: null },
  { id: 'uni', parent_id: null },
  { id: 'it', parent_id: 'uni' },
  { id: 'it-lab', parent_id: 'it' },
  { id: 'solo', parent_id: null },
];

test('subtreeIds lists the project and all descendants, parents first', () => {
  assert.deepEqual(subtreeIds(projects, 'uni'), ['uni', 'it', 'it-lab']);
  assert.deepEqual(subtreeIds(projects, 'solo'), ['solo']);
});

test('subtreeIds survives a parent cycle', () => {
  const cyclic = [
    { id: 'a', parent_id: 'b' },
    { id: 'b', parent_id: 'a' },
  ];
  assert.deepEqual(subtreeIds(cyclic, 'a'), ['a', 'b']);
});

test('counts sum over the subtree, done todos are not open', () => {
  const notes = [{ project_id: 'uni' }, { project_id: 'it' }, { project_id: 'it-lab' }, { project_id: 'solo' }];
  const todos = [
    { project_id: 'it', status: 'open' },
    { project_id: 'it-lab', status: 'in_progress' },
    { project_id: 'it-lab', status: 'done' },
  ];
  const c = countBySubtree(projects, notes, todos);
  assert.deepEqual(c.get('uni'), { notes: 3, open: 2 });
  assert.deepEqual(c.get('it'), { notes: 2, open: 2 });
  assert.deepEqual(c.get('it-lab'), { notes: 1, open: 1 });
  assert.deepEqual(c.get('solo'), { notes: 1, open: 0 });
});

test('rows without a project count for the personal project only when asked', () => {
  const notes = [{ project_id: null }, { project_id: 'persoenlich' }, { project_id: 'gone' }];
  const todos = [{ project_id: null, status: 'open' }];
  assert.deepEqual(countBySubtree(projects, notes, todos, 'persoenlich').get('persoenlich'), { notes: 2, open: 1 });
  assert.deepEqual(countBySubtree(projects, notes, todos).get('persoenlich'), { notes: 1, open: 0 });
});
