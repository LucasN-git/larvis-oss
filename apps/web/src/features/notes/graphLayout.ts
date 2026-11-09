import dagre from '@dagrejs/dagre';
import { PROJECT_PALETTE, type NoteGraph, type NoteGraphNode } from '@larvis/shared';

// Reine Geometrie und Farben des Themen-Graphen einer Notiz (ohne React).
//
// Positionen: Ein Knoten mit x/y steht dort, wo der Nutzer ihn zuletzt hingezogen hat;
// alle anderen legt Dagre aus. x/y sind die linke obere Ecke
// des Knotens (wie in React Flow). Die Layout-Richtung folgt dem Seitenverhältnis
// der Fläche (directionFor).

export const DEFAULT_WEIGHT = 3;

/** Gewicht auf 1–5 begrenzen; fehlt es, gilt 3. */
export function weightOf(node: Pick<NoteGraphNode, 'weight'>): number {
  const w = Number(node.weight ?? DEFAULT_WEIGHT);
  if (!Number.isFinite(w)) return DEFAULT_WEIGHT;
  return Math.min(5, Math.max(1, Math.round(w)));
}

/** Obergrenze der Kachelbreite, auch bei sehr langen Wörtern. */
export const MAX_NODE_WIDTH = 320;

/**
 * Kachelgröße nach Gewicht: Gewicht 1 ist klein, 5 deutlich größer. Die Breite
 * reicht mindestens für das längste Wort des Labels (geschätzt ≈ 0,62 em je Zeichen
 * bei fetter Schrift plus Innenabstand), damit kein Wort mitten durchbricht.
 */
export function nodeSize(node: Pick<NoteGraphNode, 'weight'> & { label?: string }): { width: number; height: number; fontSize: number } {
  const w = weightOf(node);
  const fontSize = 12 + (w - 1);
  const longest = Math.max(0, ...(node.label ?? '').split(/\s+/).map((word) => Array.from(word).length));
  const wordWidth = Math.ceil(longest * fontSize * 0.62 + 26);
  const width = Math.min(MAX_NODE_WIDTH, Math.max(112 + (w - 1) * 26, wordWidth));
  return { width, height: 40 + (w - 1) * 8, fontSize }; // ab 112–216 × 40–72 px
}

/**
 * Reihenfolge der Gruppen: zuerst die in `graph.groups` beschriebenen, dann die
 * übrigen in der Reihenfolge ihres ersten Vorkommens. Daraus folgt die Farbe.
 */
export function groupOrder(graph: NoteGraph): string[] {
  const order: string[] = [];
  const add = (g: string | undefined) => {
    if (g && !order.includes(g)) order.push(g);
  };
  Object.keys(graph.groups ?? {}).forEach(add);
  graph.nodes.forEach((n) => add(n.group));
  return order;
}

/** Feste Gruppenfarben aus der App-Palette (ohne Grau, das bleibt „ohne Gruppe"). */
export const GROUP_PALETTE: readonly string[] = PROJECT_PALETTE.map((c) => c.hex).filter((hex) => hex !== '#8B919A');
/** Farbe für Knoten ohne Gruppe: neutraler Text-Ton aus den Tokens. */
export const NO_GROUP_COLOR = 'var(--text-faint)';

export function groupColors(graph: NoteGraph): Map<string, string> {
  return new Map(groupOrder(graph).map((g, i) => [g, GROUP_PALETTE[i % GROUP_PALETTE.length]!]));
}

/** Kanten, deren beide Enden existieren; alles andere wird nicht gezeichnet. */
export function validEdges(graph: NoteGraph) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
}

export type LayoutDirection = 'LR' | 'TB';

/** Richtung passend zum Container: breit → links nach rechts, hoch → oben nach unten. */
export function directionFor(width: number, height: number): LayoutDirection {
  return width >= height ? 'LR' : 'TB';
}

/** Positionen aller Knoten: gespeicherte x/y, sonst Dagre (Standard links → rechts). */
export function layoutGraph(graph: NoteGraph, direction: LayoutDirection = 'LR'): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const missing = graph.nodes.some((n) => !hasPosition(n));
  if (missing) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, nodesep: 18, ranksep: 48, marginx: 12, marginy: 12 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of graph.nodes) {
      const { width, height } = nodeSize(n);
      g.setNode(n.id, { width, height });
    }
    for (const e of validEdges(graph)) {
      // Platz für die Kantenbeschriftung reservieren, damit sie nicht in Knoten läuft.
      g.setEdge(e.from, e.to, e.label ? { width: e.label.length * 6.5 + 8, height: 16, labelpos: 'c' } : {});
    }
    dagre.layout(g);
    for (const n of graph.nodes) {
      const p = g.node(n.id) as { x: number; y: number; width: number; height: number } | undefined;
      if (p) out.set(n.id, { x: Math.round(p.x - p.width / 2), y: Math.round(p.y - p.height / 2) });
    }
  }
  for (const n of graph.nodes) {
    if (hasPosition(n)) out.set(n.id, { x: n.x!, y: n.y! });
    else if (!out.has(n.id)) out.set(n.id, { x: 0, y: 0 });
  }
  return out;
}

function hasPosition(n: NoteGraphNode): boolean {
  return typeof n.x === 'number' && typeof n.y === 'number' && Number.isFinite(n.x) && Number.isFinite(n.y);
}

/** Graph mit neuen Positionen für die genannten Knoten (gerundet); alle anderen Felder bleiben. */
export function withPositions(graph: NoteGraph, positions: Map<string, { x: number; y: number }>): NoteGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const p = positions.get(n.id);
      return p ? { ...n, x: Math.round(p.x), y: Math.round(p.y) } : n;
    }),
  };
}

/** „Layout zurücksetzen": alle gespeicherten Positionen entfernen. */
export function clearPositions(graph: NoteGraph): NoteGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(({ x: _x, y: _y, ...rest }) => rest),
  };
}

export function hasAnyPosition(graph: NoteGraph): boolean {
  return graph.nodes.some(hasPosition);
}

/** Nachbarn eines Knotens mit Richtung und Kantenbeschriftung, für die Seitenleiste. */
export function neighbours(graph: NoteGraph, id: string) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: { node: NoteGraphNode; label?: string; direction: 'out' | 'in' }[] = [];
  for (const e of validEdges(graph)) {
    if (e.from === id) out.push({ node: byId.get(e.to)!, label: e.label, direction: 'out' });
    else if (e.to === id) out.push({ node: byId.get(e.from)!, label: e.label, direction: 'in' });
  }
  return out;
}
