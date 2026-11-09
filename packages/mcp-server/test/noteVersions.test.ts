import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteGraphSchema, parseNoteGraph } from '../src/noteVersions.js';

const graph = {
  nodes: [
    { id: 'zutat', label: 'Zutat', group: 'zutat', weight: 5 },
    { id: 'rezept', label: 'Rezept', group: 'rezept', note: 'Braucht **Zutaten**.', x: 10, y: -4 },
  ],
  edges: [{ from: 'rezept', to: 'zutat', label: 'treibt' }],
  groups: { zutat: 'Zutat', rezept: 'Rezept' },
};

function issues(input: unknown): string[] {
  const r = noteGraphSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

test('a valid graph passes unchanged; edges default to an empty list', () => {
  assert.deepEqual(parseNoteGraph(graph), graph);
  assert.deepEqual(parseNoteGraph({ nodes: [{ id: 'a', label: 'A' }] }).edges, []);
});

test('graph without nodes is refused', () => {
  assert.deepEqual(issues({ nodes: [], edges: [] }), ['graph.nodes darf nicht leer sein']);
});

test('duplicate node ids are refused', () => {
  const msgs = issues({ nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], edges: [] });
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /doppelt/);
});

test('edges pointing at unknown nodes are refused, per end', () => {
  const msgs = issues({ nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'x' }, { from: 'y', to: 'z' }] });
  assert.equal(msgs.length, 3);
  assert.ok(msgs.every((m) => /unbekannten Knoten/.test(m)));
});

test('weight must be an integer from 1 to 5', () => {
  for (const weight of [0, 6, 2.5]) {
    const r = noteGraphSchema.safeParse({ nodes: [{ id: 'a', label: 'A', weight }] });
    assert.equal(r.success, false, `weight ${weight}`);
    assert.deepEqual(r.error!.issues.map((i) => i.path.join('.')), ['nodes.0.weight']);
  }
  assert.deepEqual(issues({ nodes: [{ id: 'a', label: 'A', weight: 1 }, { id: 'b', label: 'B', weight: 5 }] }), []);
});

test('unknown keys (e.g. source/target instead of from/to) are refused', () => {
  const r = noteGraphSchema.safeParse({ nodes: [{ id: 'a', label: 'A' }], edges: [{ source: 'a', target: 'a' }] });
  assert.equal(r.success, false);
  const paths = r.error!.issues.map((i) => i.path.join('.'));
  assert.ok(paths.includes('edges.0.from') && paths.includes('edges.0.to'), paths.join(','));
});
