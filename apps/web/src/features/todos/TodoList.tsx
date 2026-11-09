import { useCallback, useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { PERSONAL_PROJECT_SLUG, projectColorMap, type Area } from '@larvis/shared';
import { listProjects, listTodos, type TodoFilter } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { TodoRow } from './TodoRow';
import { TodoEditorModal } from './TodoEditorModal';
import { capRows } from './cap';
import './todos.css';

interface Props {
  filter?: TodoFilter;
  /** Defaults applied to newly created todos. `today` seeds the due date to today. */
  defaults?: { area?: Area; project_id?: string | null; today?: boolean };
  emptyText?: string;
  /** Show at most this many rows, then an "Alle anzeigen (n)" footer row linking to `moreHref`. */
  limit?: number;
  moreHref?: string;
  /** Cap the list's height and scroll inside it (Heute page). */
  scroll?: boolean;
  /** Hide the "Neues ToDo" row (e.g. the backlog section). */
  showAdd?: boolean;
}

/** A todo list as one group: "Neues ToDo" row on top, the rows, optionally a
 *  footer row. The caller places it directly on the page (no surrounding Card). */
export function TodoList({
  filter = {},
  defaults = {},
  emptyText = 'Keine offenen ToDos.',
  limit,
  moreHref,
  showAdd = true,
  scroll = false,
}: Props) {
  const [newOpen, setNewOpen] = useState(false);
  // Just-added todos are held on top until the next reload. The server order
  // stays priority-sorted, so a refresh re-sorts them into their real place.
  const [pinned, setPinned] = useState<string[]>([]);
  const filterKey = JSON.stringify(filter);
  const fetcher = useCallback(() => listTodos(filter), [filterKey]);
  const { data: todos, loading } = useLiveQuery(fetcher, ['todos'], [filterKey], `todos:${filterKey}`);
  const { data: projects } = useLiveQuery(listProjects, ['projects'], [], 'projects');
  const colors = useMemo(() => projectColorMap(projects ?? []), [projects]);
  const personalId = projects?.find((p) => p.slug === PERSONAL_PROJECT_SLUG)?.id;

  const ordered = useMemo(() => {
    if (!todos || pinned.length === 0) return todos;
    const rank = new Map(pinned.map((id, i) => [id, i]));
    const top = todos
      .filter((t) => rank.has(t.id))
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    const rest = todos.filter((t) => !rank.has(t.id));
    return [...top, ...rest];
  }, [todos, pinned]);

  const { visible, hidden: hiddenCount } = capRows(ordered ?? [], limit);

  return (
    <>
      <div className={clsx('group todo-group', scroll && 'list--scroll')}>
        {showAdd && (
          <button type="button" className="group__add" onClick={() => setNewOpen(true)}>
            <span className="todo-add__icon" aria-hidden>
              <Plus size={20} />
            </span>
            Neues ToDo
          </button>
        )}

        {visible.map((t) => (
          <TodoRow key={t.id} todo={t} projectColor={colors.get(t.project_id ?? personalId ?? '') ?? null} />
        ))}
        {ordered && ordered.length === 0 && !loading && <div className="group__empty">{emptyText}</div>}

        {hiddenCount > 0 && moreHref && (
          <Link to={moreHref} className="group__foot more-link">
            Alle anzeigen ({hiddenCount})
            <ChevronRight size={16} aria-hidden />
          </Link>
        )}
      </div>

      {newOpen && (
        <TodoEditorModal
          todo={null}
          open
          onClose={() => setNewOpen(false)}
          defaults={defaults}
          onCreated={(t) => setPinned((p) => (p.includes(t.id) ? p : [t.id, ...p]))}
        />
      )}
    </>
  );
}
