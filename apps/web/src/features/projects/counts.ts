import { descendantIds, type Project } from '@larvis/shared';

type TreeProject = Pick<Project, 'id' | 'parent_id'>;
type Scoped = { project_id: string | null };
type ScopedTodo = Scoped & { status: string };

export interface SubtreeCount {
  /** Notes in the project and all its sub-projects. */
  notes: number;
  /** Not-done todos in the project and all its sub-projects. */
  open: number;
}

/** The project itself plus every descendant, parents before children. Cycles stop. */
export const subtreeIds = (projects: readonly TreeProject[], rootId: string): string[] => [
  ...new Set([rootId, ...descendantIds(projects, rootId)]),
];

/**
 * Note and open-todo counts per project, each summed over the project's whole
 * subtree. Rows without a project are counted for `unassignedTo` (the "Persönlich"
 * project) when given; rows of unknown projects are ignored.
 */
export function countBySubtree(
  projects: readonly TreeProject[],
  notes: readonly Scoped[],
  todos: readonly ScopedTodo[],
  unassignedTo?: string | null,
): Map<string, SubtreeCount> {
  const own = new Map<string, SubtreeCount>(projects.map((p) => [p.id, { notes: 0, open: 0 }]));
  const bucket = (projectId: string | null) => own.get(projectId ?? unassignedTo ?? '');
  for (const n of notes) {
    const b = bucket(n.project_id);
    if (b) b.notes += 1;
  }
  for (const t of todos) {
    if (t.status === 'done') continue;
    const b = bucket(t.project_id);
    if (b) b.open += 1;
  }

  const result = new Map<string, SubtreeCount>();
  for (const p of projects) {
    const sum = { notes: 0, open: 0 };
    for (const id of subtreeIds(projects, p.id)) {
      const c = own.get(id)!;
      sum.notes += c.notes;
      sum.open += c.open;
    }
    result.set(p.id, sum);
  }
  return result;
}
