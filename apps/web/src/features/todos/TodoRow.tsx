import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Archive, ArchiveRestore, Check, Sun, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { Todo } from '@larvis/shared';
import { setTodoBacklog, setTodoDone, setTodoToday, deleteTodo, restoreTodo } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatDue, isDueToday, priorityColor } from '../../lib/format';
import { Chip, IconButton } from '../../components/ui';
import { TodoEditorModal } from './TodoEditorModal';

// Swipe past this many px (either way) to commit: right = done, left = backlog.
const COMMIT_PX = 72;
// A left swipe past this share of the row width deletes instead.
const DELETE_FRAC = 0.6;
// Clamp the live drag so the row never flies off-screen while held.
const MAX_RIGHT = 150;
const MAX_LEFT_FRAC = 0.85;

type SwipeAction = 'done' | 'backlog' | 'delete';

export function TodoRow({
  todo,
  showDelete = true,
  editable = true,
  projectColor,
}: {
  todo: Todo;
  showDelete?: boolean;
  editable?: boolean;
  /** Wirksame Projektfarbe (vererbt, siehe projectColorMap): färbt den Ring des Hakens. */
  projectColor?: string | null;
}) {
  // Optimistisch: der Haken flippt sofort, der Server zieht nach. Kommt der
  // echte Status per Refetch an, gilt wieder der.
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);
  useEffect(() => setOptimisticDone(null), [todo.status]);
  const done = optimisticDone ?? todo.status === 'done';
  // Gleiches Muster für die Sonne: sofort umschalten, Server zieht nach. "Heute"
  // ist jetzt datumsbasiert — die Sonne leuchtet, wenn das ToDo heute fällig ist.
  const [optimisticToday, setOptimisticToday] = useState<boolean | null>(null);
  useEffect(() => setOptimisticToday(null), [todo.due_at]);
  const isToday = optimisticToday ?? isDueToday(todo.due_at);
  const due = formatDue(todo.due_at);
  const [open, setOpen] = useState(false);

  // Swipe (touch/pen only; the mouse uses the buttons). Right = done,
  // left = backlog, far left (past DELETE_FRAC of the row width) = delete with
  // an undo toast. Vertical intent goes back to the scroller (touch-action: pan-y).
  const { notify } = useToast();
  const [dx, setDx] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Row width of the current gesture; kept after release so the hint does not
  // flip back to "Backlog" while a deleted row slides out.
  const rowW = useRef(0);
  const axis = useRef<'h' | 'v' | null>(null);
  const swiped = useRef(false);

  const deleteAt = rowW.current * DELETE_FRAC;
  const action: SwipeAction | null =
    dx >= COMMIT_PX ? 'done' : dx <= -COMMIT_PX ? (deleteAt > 0 && -dx >= deleteAt ? 'delete' : 'backlog') : null;

  // Haptic tick when the gesture crosses into another action.
  const lastAction = useRef<SwipeAction | null>(null);
  useEffect(() => {
    if (action && action !== lastAction.current) navigator.vibrate?.(10);
    lastAction.current = action;
  }, [action]);

  const remove = () => {
    void deleteTodo(todo.id)
      .then(() =>
        notify('ToDo gelöscht', 'info', {
          action: { label: 'Rückgängig', onClick: () => void restoreTodo(todo.id).catch(() => notify('Wiederherstellen fehlgeschlagen', 'error')) },
        }),
      )
      .catch(() => {
        setDx(0);
        notify('Löschen fehlgeschlagen', 'error');
      });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    swiped.current = false;
    if (e.pointerType === 'mouse') return;
    start.current = { x: e.clientX, y: e.clientY };
    rowW.current = e.currentTarget.getBoundingClientRect().width;
    axis.current = null;
    setSnapping(false);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const ddx = e.clientX - start.current.x;
    const ddy = e.clientY - start.current.y;
    if (axis.current === null) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
      if (axis.current === 'h') e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (axis.current === 'h') setDx(Math.max(-rowW.current * MAX_LEFT_FRAC, Math.min(MAX_RIGHT, ddx)));
  };

  const onPointerUp = () => {
    if (axis.current === 'h') {
      setSnapping(true);
      if (action) swiped.current = true;
      if (action === 'done') {
        setDx(0);
        const next = !done;
        setOptimisticDone(next);
        void setTodoDone(todo.id, next).catch(() => setOptimisticDone(null));
      } else if (action === 'backlog') {
        rowW.current = 0;
        setDx(-window.innerWidth); // slide out; filtered lists drop the row on refetch
        void setTodoBacklog(todo.id, !todo.backlog);
        // Lists that don't filter backlog keep the row — settle it back in place.
        window.setTimeout(() => setDx(0), 220);
      } else if (action === 'delete') {
        setDx(-window.innerWidth);
        remove();
      } else {
        setDx(0);
      }
    }
    start.current = null;
    axis.current = null;
  };

  const hint =
    dx > 0
      ? { cls: 'todo-swipe--done', icon: <Check size={18} strokeWidth={3} />, label: done ? 'Offen' : 'Erledigt' }
      : action === 'delete'
        ? { cls: 'todo-swipe--delete todo-swipe--end', icon: <Trash2 size={18} />, label: 'Löschen' }
        : {
            cls: 'todo-swipe--backlog todo-swipe--end',
            icon: todo.backlog ? <ArchiveRestore size={18} /> : <Archive size={18} />,
            label: todo.backlog ? 'Zurück' : 'Backlog',
          };

  return (
    <div className="swipe-wrap todo-row">
      {dx !== 0 && (
        <div key={hint.cls} className={clsx('swipe-bg', hint.cls)} aria-hidden>
          {hint.icon}
          <span>{hint.label}</span>
        </div>
      )}

      <div
        className={clsx('item-row', snapping && 'item-row--snap')}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Suppress the click that may follow a horizontal swipe.
        onClickCapture={(e) => {
          if (swiped.current) {
            e.preventDefault();
            e.stopPropagation();
            swiped.current = false;
          }
        }}
      >
        <button
          className={clsx('check', projectColor && 'check--proj')}
          style={projectColor ? ({ '--proj': projectColor } as CSSProperties) : undefined}
          data-done={done}
          aria-label={done ? 'Als offen markieren' : 'Als erledigt markieren'}
          onClick={() => {
            const next = !done;
            setOptimisticDone(next);
            void setTodoDone(todo.id, next).catch(() => setOptimisticDone(null));
          }}
        >
          <Check size={15} strokeWidth={3} />
        </button>

        <button
          className="item-row__main"
          style={{ textAlign: 'left', cursor: editable ? 'pointer' : 'default' }}
          onClick={() => editable && setOpen(true)}
          disabled={!editable}
        >
          <div className={clsx('item-row__title', done && 'done-text')}>{todo.title}</div>
          {(due || todo.status === 'doing' || todo.tags.length > 0) && (
            <div className="meta-row" style={{ marginTop: 4 }}>
              {todo.priority > 0 && <span className="prio-dot" style={{ background: priorityColor(todo.priority) }} />}
              {todo.status === 'doing' && <span className="item-row__sub text-accent">In Arbeit</span>}
              {due && (
                <span className="item-row__sub" style={{ color: due.overdue ? 'var(--danger)' : undefined }}>
                  {due.label}
                </span>
              )}
              {todo.tags.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          )}
        </button>

        <IconButton
          variant="bare"
          size="sm"
          className="todo-row__sun"
          label={isToday ? 'Von heute entfernen' : 'Für heute markieren'}
          aria-pressed={isToday}
          onClick={() => {
            const next = !isToday;
            setOptimisticToday(next);
            void setTodoToday(todo.id, next).catch(() => setOptimisticToday(null));
          }}
          style={{ color: isToday ? 'var(--accent)' : undefined }}
        >
          <Sun size={15} fill={isToday ? 'currentColor' : 'none'} />
        </IconButton>

        {showDelete && (
          <IconButton variant="bare" size="sm" className="todo-row__delete" label="Löschen" onClick={remove}>
            <Trash2 size={15} />
          </IconButton>
        )}
      </div>

      {editable && open && <TodoEditorModal todo={todo} open onClose={() => setOpen(false)} />}
    </div>
  );
}
