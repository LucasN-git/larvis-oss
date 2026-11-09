// Generische Baum-Helfer für Tabellen mit parent_id + sort_order (Notizen, Learnings).
// Ein „Ordner" ist immer ein Eintrag mit Kindern, keine eigene Entität; Einträge, deren
// Eltern in der Liste fehlen (oder null sind), werden Wurzeln. Geschwister sind nach
// sort_order, dann Titel sortiert.

export interface TreeItem {
  id: string;
  parent_id: string | null;
  sort_order: number;
  title: string;
}

export type TreeNode<T extends TreeItem> = T & { children: TreeNode<T>[] };

/** Build a nested tree from a flat list. */
export function buildTree<T extends TreeItem>(items: readonly T[]): TreeNode<T>[] {
  const byId = new Map<string, TreeNode<T>>();
  for (const it of items) byId.set(it.id, { ...it, children: [] });

  const roots: TreeNode<T>[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** Flatten any node tree (projects, notes, learnings) to a depth-annotated list for indented rendering. */
export function flattenTree<N extends { children: N[] }>(nodes: N[], depth = 0): { node: N; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenTree(node.children, depth + 1)]);
}

/** All descendant ids of an item (used to prevent cyclic re-parenting). */
export function descendantIds(items: readonly Pick<TreeItem, 'id' | 'parent_id'>[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const it of items) {
    if (!it.parent_id) continue;
    (childrenOf.get(it.parent_id) ?? childrenOf.set(it.parent_id, []).get(it.parent_id)!).push(it.id);
  }
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const c of childrenOf.get(id) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        walk(c);
      }
    }
  };
  walk(rootId);
  return out;
}

/** Path from the root down to `id` (inclusive), e.g. for breadcrumbs. Empty if unknown. */
export function pathTo<T extends TreeItem>(items: readonly T[], id: string): T[] {
  const byId = new Map(items.map((it) => [it.id, it] as const));
  const out: T[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}
