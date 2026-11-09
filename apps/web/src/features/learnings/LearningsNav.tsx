import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Plus } from 'lucide-react';
import { buildTree, pathTo, type Learning, type LearningNode } from '@larvis/shared';
import { TextInput } from '../../components/ui';

// Seitenbaum eines Bereichs. Ein „Ordner" ist eine Seite mit Unterseiten; jede Zeile
// ist ein Link auf die Seite. Die Vorfahren der aktiven Seite sind aufgeklappt, damit
// ein Deep-Link seinen Kontext zeigt. Das Filterfeld sucht flach über Titel und Slug des Bereichs.
export function LearningsNav({
  area,
  pages,
  activeSlug,
  loading,
  error,
  onCreateChild,
}: {
  area: string;
  pages: Learning[];
  activeSlug?: string;
  loading: boolean;
  error: string | null;
  onCreateChild: (parent: Learning) => void;
}) {
  const tree = useMemo(() => buildTree(pages), [pages]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const active = activeSlug ? pages.find((p) => p.slug === activeSlug) : undefined;
    if (!active) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of pathTo(pages, active.id)) next.add(p.id);
      return next;
    });
  }, [activeSlug, pages]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const q = filter.trim().toLowerCase();
  const hits = q ? pages.filter((p) => p.title.toLowerCase().includes(q) || p.slug.includes(q)) : null;

  function Row({ node, depth }: { node: LearningNode; depth: number }) {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    const active = node.slug === activeSlug;
    return (
      <>
        <div className={clsx('tree-row', active && 'tree-row--active')} style={{ paddingLeft: depth * 18 + 6 }}>
          <button
            className="tree-row__twist"
            onClick={() => hasChildren && toggle(node.id)}
            aria-label={hasChildren ? (isOpen ? 'Zuklappen' : 'Aufklappen') : undefined}
            tabIndex={hasChildren ? 0 : -1}
          >
            {hasChildren ? (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : <span className="tree-row__spacer" />}
          </button>
          {hasChildren ? (
            isOpen ? <FolderOpen size={16} className="tree-row__icon" /> : <Folder size={16} className="tree-row__icon" />
          ) : (
            <FileText size={15} className="tree-row__icon tree-row__icon--file" />
          )}
          <NavLink to={`/learnings/${node.slug}`} className="tree-row__label" title={node.summary ?? undefined}>
            <span className="tree-row__title">{node.title}</span>
            {hasChildren && <span className="tree-row__count">{node.children.length}</span>}
          </NavLink>
          <button className="tree-row__add" aria-label="Unterseite anlegen" title="Unterseite anlegen" onClick={() => onCreateChild(node)}>
            <Plus size={15} />
          </button>
        </div>
        {isOpen && node.children.map((c) => <Row key={c.id} node={c} depth={depth + 1} />)}
      </>
    );
  }

  return (
    <div className="stack gap-sm">
      {(pages.length > 3 || filter) && (
        <TextInput className="wiki__filter" placeholder="Seiten filtern…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {error && <div className="empty">Seiten konnten nicht geladen werden: {error}</div>}
      {!error && loading && pages.length === 0 && <div className="empty">Lädt…</div>}
      {!error && !loading && pages.length === 0 && (
        <div className="empty">{area ? `Noch keine Seiten in ${area}.` : 'Noch keine Seiten.'}</div>
      )}
      {hits ? (
        hits.length === 0 ? (
          <div className="empty">Nichts gefunden.</div>
        ) : (
          <div className="tree">
            {hits.map((p) => (
              <div key={p.id} className={clsx('tree-row', p.slug === activeSlug && 'tree-row--active')} style={{ paddingLeft: 6 }}>
                <span className="tree-row__twist"><span className="tree-row__spacer" /></span>
                <FileText size={15} className="tree-row__icon tree-row__icon--file" />
                <NavLink to={`/learnings/${p.slug}`} className="tree-row__label" title={p.summary ?? undefined}>
                  <span className="tree-row__title">{p.title}</span>
                </NavLink>
              </div>
            ))}
          </div>
        )
      ) : (
        tree.length > 0 && (
          <div className="tree">
            {tree.map((n) => <Row key={n.id} node={n} depth={0} />)}
          </div>
        )
      )}
    </div>
  );
}
