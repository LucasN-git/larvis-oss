import { isProjectActive, type Project, type ProjectNode } from './types.js';

/**
 * Slug des persönlichen Projekts „Persönlich": es nimmt alle Notizen und ToDos ohne
 * eigenes Projekt auf (angelegt von der Migration 20260628180000).
 */
export const PERSONAL_PROJECT_SLUG = 'persoenlich';

/**
 * Konvention für Code-/Arbeitsordner von Projekten auf dem eigenen Rechner: Root + Slug.
 * Die Web-App speichert den Pfad als local_path für Deep-Links. Den Root an den eigenen
 * Rechner anpassen.
 */
export const LOCAL_PROJECTS_ROOT = '/home/user/projects';

/** Standard-Arbeitsordner eines Projekts (Konvention: Root + Slug). */
export function defaultProjectPath(slug: string): string {
  return `${LOCAL_PROJECTS_ROOT}/${slug}`;
}

/**
 * Projekte für Zuordnungs-Dropdowns (Todos, Termine, Notizen): nur aktive —
 * plus das aktuell zugewiesene, damit eine bestehende Zuordnung zu einem
 * inzwischen inaktiven Projekt sichtbar und unverändert speicherbar bleibt.
 */
export function selectableProjects(projects: Project[], currentId?: string | null): Project[] {
  return projects.filter((p) => isProjectActive(p) || p.id === currentId);
}

/** Build a nested tree from a flat project list (orphans become roots). */
export function buildProjectTree(projects: Project[]): ProjectNode[] {
  const byId = new Map<string, ProjectNode>();
  for (const p of projects) byId.set(p.id, { ...p, children: [] });

  const roots: ProjectNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (nodes: ProjectNode[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}


/** Eine Farbe der festen Projektpalette, mit passender Google-Kalender-Farbe. */
export interface PaletteColor {
  hex: string;
  label: string;
  googleColorId: string;
}

/**
 * Die feste Palette, aus der Projekte ihre Farbe wählen. Jede Farbe trägt die
 * Google-colorId, die ihr in Googles eigener Kalenderansicht am nächsten kommt.
 */
export const PROJECT_PALETTE: readonly PaletteColor[] = [
  { hex: '#14B8A6', label: 'Türkis', googleColorId: '2' },
  { hex: '#2E9E4F', label: 'Grün', googleColorId: '10' },
  { hex: '#D4A21A', label: 'Gold', googleColorId: '5' },
  { hex: '#8B919A', label: 'Grau', googleColorId: '8' },
  { hex: '#F2811D', label: 'Orange', googleColorId: '6' },
  { hex: '#2F55C6', label: 'Dunkelblau', googleColorId: '9' },
  { hex: '#0A8CFF', label: 'Knallblau', googleColorId: '7' },
  { hex: '#8B5CF6', label: 'Violett', googleColorId: '3' },
  { hex: '#E0571F', label: 'Larvis-Orange', googleColorId: '11' },
];

type ColorProject = Pick<Project, 'id' | 'parent_id' | 'color'>;

const MAX_COLOR_DEPTH = 16;

function effectiveColorIn(byId: Map<string, ColorProject>, id: string | null | undefined): string | null {
  const visited = new Set<string>();
  let cur = id ? byId.get(id) : undefined;
  for (let depth = 0; cur && depth < MAX_COLOR_DEPTH; depth++) {
    if (cur.color) return cur.color;
    if (visited.has(cur.id)) return null;
    visited.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return null;
}

/**
 * Die wirksame Farbe eines Projekts. Ein Unterprojekt ohne eigene Farbe erbt die
 * seines Elternprojekts (rekursiv nach oben). Das ist das eine Farbsystem für
 * ToDos und Termine: beide färben sich über diese Funktion. Unbekannte id oder
 * eine Kette ganz ohne Farbe → null; Zyklen brechen ab.
 */
export function effectiveProjectColor(projects: readonly ColorProject[], id: string | null | undefined): string | null {
  return effectiveColorIn(new Map(projects.map((p) => [p.id, p])), id);
}

/** Projekt-id → wirksame Farbe (vererbt, siehe effectiveProjectColor) für alle Projekte. */
export function projectColorMap(projects: readonly ColorProject[]): Map<string, string | null> {
  const byId = new Map(projects.map((p) => [p.id, p]));
  return new Map(projects.map((p) => [p.id, effectiveColorIn(byId, p.id)]));
}

/**
 * Vorschlag für ein neues Hauptprojekt: die erste Palettenfarbe, die noch kein
 * anderes Hauptprojekt trägt (Unterprojekte zählen nicht, sie erben meist).
 * Sind alle vergeben, beginnt die Palette von vorn.
 */
export function firstUnusedPaletteColor(projects: readonly Pick<Project, 'parent_id' | 'color'>[]): string {
  const used = new Set(projects.filter((p) => !p.parent_id && p.color).map((p) => p.color!.toUpperCase()));
  return (PROJECT_PALETTE.find((c) => !used.has(c.hex.toUpperCase())) ?? PROJECT_PALETTE[0]!).hex;
}
