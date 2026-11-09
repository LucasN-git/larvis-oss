import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NoteGraph } from '@larvis/shared';
import {
  clearPositions,
  directionFor,
  groupColors,
  groupOrder,
  layoutGraph,
  neighbours,
  nodeSize,
  validEdges,
  weightOf,
  withPositions,
} from '../src/features/notes/graphLayout';

const graph: NoteGraph = {
  nodes: [
    { id: 'rezept', label: 'Rezept', group: 'rezept', weight: 5 },
    { id: 'zutat', label: 'Zutat', group: 'zutat' },
    { id: 'kueche', label: 'Küche', group: 'kueche', x: 400, y: 50 },
    { id: 'frei', label: 'Ohne Gruppe' },
  ],
  edges: [
    { from: 'rezept', to: 'zutat', label: 'braucht' },
    { from: 'zutat', to: 'kueche' },
    { from: 'kueche', to: 'gibt-es-nicht' },
  ],
  groups: { kueche: 'Küche und Vorrat' },
};

test('Gewicht wird auf 1–5 begrenzt, fehlend = 3', () => {
  assert.equal(weightOf({}), 3);
  assert.equal(weightOf({ weight: 9 }), 5);
  assert.equal(weightOf({ weight: 0 }), 1);
  assert.ok(nodeSize({ weight: 5 }).width > nodeSize({ weight: 1 }).width);
});

test('Gruppen: beschriebene zuerst, gleiche Gruppe = gleiche Farbe', () => {
  assert.deepEqual(groupOrder(graph), ['kueche', 'rezept', 'zutat']);
  const colors = groupColors(graph);
  assert.equal(new Set(colors.values()).size, 3);
});

test('Kanten auf unbekannte Knoten fallen weg', () => {
  assert.equal(validEdges(graph).length, 2);
});

test('Layout: gespeicherte Position gewinnt, der Rest wird ausgelegt (links → rechts)', () => {
  const pos = layoutGraph(graph);
  assert.deepEqual(pos.get('kueche'), { x: 400, y: 50 });
  assert.equal(pos.size, 4);
  // LR: das Ziel einer Kante liegt rechts von der Quelle.
  assert.ok(pos.get('zutat')!.x > pos.get('rezept')!.x);
});

test('Positionen speichern und zurücksetzen', () => {
  const moved = withPositions(graph, new Map([['rezept', { x: 12.6, y: -3.2 }]]));
  assert.deepEqual({ x: moved.nodes[0]!.x, y: moved.nodes[0]!.y }, { x: 13, y: -3 });
  assert.equal(moved.nodes[0]!.label, 'Rezept');
  const reset = clearPositions(moved);
  assert.ok(reset.nodes.every((n) => n.x === undefined && n.y === undefined));
  assert.deepEqual(reset.groups, graph.groups);
});

test('Nachbarn mit Richtung und Beschriftung', () => {
  const n = neighbours(graph, 'zutat');
  assert.deepEqual(
    n.map((x) => [x.node.id, x.direction, x.label]),
    [['rezept', 'in', 'braucht'], ['kueche', 'out', undefined]],
  );
});

test('Richtung folgt dem Seitenverhältnis; TB legt Ziele unter die Quelle', () => {
  assert.equal(directionFor(1200, 700), 'LR');
  assert.equal(directionFor(390, 700), 'TB');
  const pos = layoutGraph({ nodes: graph.nodes.filter((n) => n.x === undefined), edges: graph.edges }, 'TB');
  assert.ok(pos.get('zutat')!.y > pos.get('rezept')!.y);
});

test('Kachel ist breit genug für das längste Wort, mit Obergrenze', () => {
  const kurz = nodeSize({ label: 'Rezept' });
  const lang = nodeSize({ label: 'Wochenmarktbesuch heute' });
  assert.ok(lang.width > kurz.width);
  assert.ok(lang.width >= Math.ceil('Wochenmarktbesuch'.length * lang.fontSize * 0.62));
  assert.ok(nodeSize({ label: 'x'.repeat(200) }).width <= 320);
});
