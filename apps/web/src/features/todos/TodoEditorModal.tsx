import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { addDays, format, parseISO } from 'date-fns';
import { selectableProjects, type Area, type Priority, type Project, type Todo, type TodoStatus } from '@larvis/shared';
import { createTodo, deleteTodo, listProjects, listTags, updateTodo } from '../../lib/api';
import { isAllDayDue, priorityColor, PRIORITY_LABELS } from '../../lib/format';
import { useAutosave } from '../../lib/useAutosave';
import { useToast } from '../../lib/toast';
import { Drawer } from '../../components/Drawer';
import { DatePicker, TimePicker } from '../../components/DateTimePicker';
import { ReminderField } from '../../components/ReminderField';
import type { ReminderTarget } from '../../lib/reminders';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { TagInput } from '../../components/TagInput';
import { Button, SaveStatus, Segmented, TextInput } from '../../components/ui';

const PRIORITIES: Priority[] = [0, 1, 2, 3];

function Label({ children }: { children: string }) {
  return <div className="section-title" style={{ margin: '0 0 8px' }}>{children}</div>;
}

/**
 * Formularwerte → due_at. Kein Datum → kein Termin. Datum ohne Uhrzeit →
 * ganztägig (UTC-Mitternacht). Datum + Uhrzeit → konkreter lokaler Slot.
 */
function toDueAt(due: string, dueTime: string): string | null {
  if (!due) return null;
  return dueTime ? new Date(`${due}T${dueTime}`).toISOString() : `${due}T00:00:00.000Z`;
}

export function TodoEditorModal({
  todo,
  open,
  onClose,
  defaults,
  onCreated,
}: {
  /** null = a blank draft; the row is only created once a title is entered. */
  todo: Todo | null;
  open: boolean;
  onClose: () => void;
  defaults?: { area?: Area; project_id?: string | null; today?: boolean };
  onCreated?: (todo: Todo) => void;
}) {
  const { saved } = useToast();
  const isNew = todo === null;
  const [title, setTitle] = useState(todo?.title ?? '');
  const [status, setStatus] = useState<TodoStatus>(todo?.status ?? 'todo');
  const [priority, setPriority] = useState<Priority>(todo?.priority ?? 0);
  const [backlog, setBacklog] = useState(todo?.backlog ?? false);
  // Datum + Uhrzeit getrennt: leere Uhrzeit = ganztägig, kein Datum = ohne Termin.
  // Ein neues ToDo auf der Heute-Seite startet direkt mit heutigem Datum.
  const [due, setDue] = useState(
    todo?.due_at
      ? format(parseISO(todo.due_at), 'yyyy-MM-dd')
      : isNew && defaults?.today
        ? format(new Date(), 'yyyy-MM-dd')
        : '',
  );
  const [dueTime, setDueTime] = useState(
    todo?.due_at && !isAllDayDue(todo.due_at) ? format(parseISO(todo.due_at), 'HH:mm') : '',
  );
  // Ganztägig ist der Default; „Uhrzeit" blendet erst das Zeitfeld ein. timed ist
  // reine UI-Ansicht — persistiert wird allein über dueTime (leer = ganztägig).
  const [timed, setTimed] = useState(Boolean(todo?.due_at && !isAllDayDue(todo.due_at)));
  const [projectId, setProjectId] = useState<string | null>(todo?.project_id ?? defaults?.project_id ?? null);
  const [tags, setTags] = useState<string[]>(todo?.tags ?? []);
  const [body, setBody] = useState(todo?.body_md ?? '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [knownTags, setKnownTags] = useState<string[]>([]);

  // The row id: known up-front for an existing todo, filled in on the first save
  // (title entered) for a new draft. Drives create-vs-update below.
  const idRef = useRef<string | null>(todo?.id ?? null);
  // Mirror the id into state so the reminder bell enables once the row exists
  // (the ref alone wouldn't re-render after the first autosave creates it).
  const [rowId, setRowId] = useState<string | null>(todo?.id ?? null);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
    listTags().then(setKnownTags).catch(() => setKnownTags([]));
  }, []);

  const { state } = useAutosave({
    value: { title, status, priority, backlog, due, dueTime, projectId, tags, body },
    onSaved: saved,
    // Only persist once there's a title — a blank draft closes without a row.
    canSave: (v) => v.title.trim().length > 0,
    onSave: async (v) => {
      const fields = {
        title: v.title.trim(),
        status: v.status,
        priority: v.priority,
        backlog: v.backlog,
        due_at: toDueAt(v.due, v.dueTime),
        completed_at: v.status === 'done' ? todo?.completed_at ?? new Date().toISOString() : null,
        project_id: v.projectId,
        area: (v.projectId ? 'project' : 'personal') as Area,
        tags: v.tags,
        body_md: v.body,
      };
      if (idRef.current) {
        await updateTodo(idRef.current, fields);
      } else {
        const created = await createTodo(fields);
        idRef.current = created.id;
        setRowId(created.id);
        onCreated?.(created);
      }
    },
  });

  // Erinnerungsziel: erst wählbar, sobald das Todo eine Zeile hat (rowId). start
  // ist die Fälligkeit wie gespeichert, damit die Glocke den passenden Standard
  // des ToDo-Themas zeigt: Vorlauf bei Uhrzeit, Sammelnachricht bei ganztägig,
  // ohne Datum keine Nachricht.
  const reminderTarget: ReminderTarget | null = rowId
    ? {
        kind: 'todo',
        todoId: rowId,
        title: title.trim() || 'Todo',
        start: toDueAt(due, dueTime),
      }
    : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? 'Neues ToDo' : 'ToDo bearbeiten'}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={async () => {
              if (idRef.current) await deleteTodo(idRef.current);
              onClose();
            }}
            style={{ color: 'var(--danger)', marginRight: 'auto' }}
          >
            <Trash2 size={16} /> {isNew ? 'Verwerfen' : 'Löschen'}
          </Button>
          <SaveStatus state={state} />
          <Button variant="primary" onClick={onClose}>Fertig</Button>
        </>
      }
    >
      <div className="stack gap-md">
        <TextInput placeholder="Titel" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={isNew} />

        <div>
          <Label>Status</Label>
          <Segmented
            options={[
              { value: 'todo', label: 'Offen' },
              { value: 'doing', label: 'In Arbeit' },
              { value: 'done', label: 'Erledigt' },
            ]}
            value={status}
            onChange={setStatus}
          />
        </div>

        <div>
          <Label>Priorität</Label>
          <Segmented
            options={PRIORITIES.map((p) => ({
              value: String(p),
              label: (
                <span className="row gap-xs center">
                  <span className="prio-dot" style={{ background: priorityColor(p) }} />
                  {PRIORITY_LABELS[p]}
                </span>
              ),
            }))}
            value={String(priority)}
            onChange={(v) => setPriority(Number(v) as Priority)}
          />
        </div>

        <div>
          <Label>Fällig</Label>
          <div className="row gap-sm wrap">
            {/* flex overrides the global width:100% so date grows and the toggle/time
                sit beside it. Ohne Datum: nur der Datepicker. Mit Datum: Ganztägig/
                Uhrzeit-Umschalter; das Zeitfeld erscheint erst im Uhrzeit-Modus. */}
            <DatePicker value={due} onChange={setDue} placeholder="Datum wählen" style={{ flex: 1, minWidth: 150 }} />
            {due && (
              <Segmented
                options={[
                  { value: 'allday', label: 'Ganztägig' },
                  { value: 'timed', label: 'Uhrzeit' },
                ]}
                value={timed ? 'timed' : 'allday'}
                onChange={(v) => {
                  if (v === 'timed') {
                    setTimed(true);
                    if (!dueTime) setDueTime('09:00');
                  } else {
                    setTimed(false);
                    setDueTime('');
                  }
                }}
              />
            )}
            {due && timed && (
              <TimePicker value={dueTime} onChange={setDueTime} placeholder="Uhrzeit" style={{ flex: '0 0 118px' }} />
            )}
          </div>
          <div className="row gap-xs wrap" style={{ marginTop: 8 }}>
            <Button size="sm" variant="ghost" onClick={() => setDue(format(new Date(), 'yyyy-MM-dd'))}>
              Heute
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDue(format(addDays(new Date(), 1), 'yyyy-MM-dd'))}>
              Morgen
            </Button>
            {due && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDue('');
                  setDueTime('');
                  setTimed(false);
                }}
                style={{ color: 'var(--text-faint)' }}
              >
                Kein Termin
              </Button>
            )}
          </div>
        </div>

        <ReminderField target={reminderTarget} placeholder="Erst Titel eingeben, dann speichern" />

        <div className="row gap-md wrap">
          <div className="grow" style={{ minWidth: 160 }}>
            <Label>Projekt</Label>
            <select className="input" value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)}>
              <option value="">Persönlich</option>
              {selectableProjects(projects, projectId).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grow" style={{ minWidth: 160 }}>
            <Label>Backlog</Label>
            <Segmented
              options={[
                { value: 'active', label: 'Aktiv' },
                { value: 'backlog', label: 'Backlog' },
              ]}
              value={backlog ? 'backlog' : 'active'}
              onChange={(v) => setBacklog(v === 'backlog')}
            />
          </div>
        </div>

        <div>
          <Label>Kategorien / Tags</Label>
          <TagInput value={tags} onChange={setTags} suggestions={knownTags} />
        </div>

        <div>
          <Label>Details</Label>
          <MarkdownEditor value={body} onChange={setBody} placeholder="Notizen, Checkliste, Links…" />
        </div>
      </div>
    </Drawer>
  );
}
