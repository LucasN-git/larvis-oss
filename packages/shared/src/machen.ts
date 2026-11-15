import { isProjectActive, type Entry, type Project } from './types.js';

/**
 * Kontext eines Eintrags und die Liste „Machen".
 *
 * Der Kontext (entries.project_id) sagt, für welches Projekt ein Fund gespeichert wurde. Er ist
 * immer ein Hauptprojekt (parent_id null, nicht gelöscht) — ein Trigger in der Datenbank weist
 * Unterprojekte ab. „Machen" sind die lebenden, nicht abgehakten Einträge (done_at null) mit Tag
 * nachmachen oder umsetzen; idee bleibt draußen. Ein Eintrag ohne gültigen Kontext (keiner,
 * Projekt gelöscht oder unbekannt) steht dort in der eigenen Gruppe „Ohne Kontext".
 */

/** Form-Tags, mit denen ein Eintrag in „Machen" steht. */
export const MACHEN_TAGS = ['nachmachen', 'umsetzen'] as const;

export type ContextProject = Pick<Project, 'id' | 'slug' | 'name' | 'parent_id' | 'status' | 'sort_order' | 'deleted_at'>;

/** Taugt das Projekt als Kontext? Nur Hauptprojekte, die nicht gelöscht sind. */
export const isContextProject = (p: Pick<Project, 'parent_id' | 'deleted_at'>): boolean => p.parent_id === null && !p.deleted_at;

/**
 * Die Kontexte in der Reihenfolge des Projekte-Tabs: die aktiven Hauptprojekte nach sort_order
 * und Name, dann die übrigen (pausiert, fertig, archiviert) ebenso.
 */
export function contextProjects<T extends ContextProject>(projects: readonly T[]): T[] {
  const rank = (p: T) => (isProjectActive(p) ? 0 : 1);
  return projects
    .filter(isContextProject)
    .sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de'));
}

/** Steht der Eintrag in „Machen"? Lebend, nicht abgehakt, mit Tag nachmachen oder umsetzen. */
export function isMachenEntry(e: Pick<Entry, 'tags' | 'deleted_at'> & { done_at?: string | null }): boolean {
  return !e.deleted_at && !e.done_at && e.tags.some((t) => (MACHEN_TAGS as readonly string[]).includes(t));
}

/** Der Kontext, unter dem „Machen" einen Eintrag führt: sein Projekt, wenn es ein gültiger Kontext ist, sonst null. */
export function machenContextId(e: Pick<Entry, 'project_id'>, contexts: readonly ContextProject[]): string | null {
  if (!e.project_id) return null;
  return contexts.find((p) => p.id === e.project_id && isContextProject(p))?.id ?? null;
}

export interface MachenGroup<T, E> {
  /** null = die Gruppe „Ohne Kontext". */
  project: T | null;
  entries: E[];
}

/**
 * Gruppiert Machen-Einträge nach Kontext: Gruppen in der Reihenfolge von contextProjects, die
 * Gruppe „Ohne Kontext" zuletzt, nur Gruppen mit Einträgen, innerhalb einer Gruppe die neuesten
 * zuerst. Nicht-Machen-Einträge fallen heraus.
 */
export function groupMachen<
  T extends ContextProject,
  E extends Pick<Entry, 'project_id' | 'tags' | 'deleted_at' | 'created_at'> & { done_at?: string | null },
>(entries: readonly E[], projects: readonly T[]): MachenGroup<T, E>[] {
  const ordered = contextProjects(projects);
  const byContext = new Map<string | null, E[]>();
  for (const e of entries) {
    if (!isMachenEntry(e)) continue;
    const key = machenContextId(e, ordered);
    const list = byContext.get(key);
    if (list) list.push(e);
    else byContext.set(key, [e]);
  }
  const newestFirst = (list: E[]) => list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const groups: MachenGroup<T, E>[] = [];
  for (const p of ordered) {
    const list = byContext.get(p.id);
    if (list) groups.push({ project: p, entries: newestFirst(list) });
  }
  const without = byContext.get(null);
  if (without) groups.push({ project: null, entries: newestFirst(without) });
  return groups;
}

/**
 * Löst eine Kontext-Angabe (Slug oder id) zu einem Hauptprojekt auf. Ein Unterprojekt, ein
 * gelöschtes oder unbekanntes Projekt ist ein Fehler, der die gültigen Slugs nennt.
 */
export function resolveContextProject<T extends ContextProject>(input: string, projects: readonly T[]): { project: T } | { error: string } {
  const key = input.trim();
  const hit = projects.find((p) => p.id === key || p.slug === key);
  if (hit && isContextProject(hit)) return { project: hit };
  const valid = contextProjects(projects).map((p) => p.slug).join(', ') || '(none yet)';
  const why = !hit
    ? `No project '${key}'.`
    : hit.deleted_at
      ? `Project '${hit.slug}' is deleted.`
      : `Project '${hit.slug}' is a sub-project; the context is always a top-level project.`;
  return { error: `${why} Valid contexts (top-level project slugs): ${valid}.` };
}
