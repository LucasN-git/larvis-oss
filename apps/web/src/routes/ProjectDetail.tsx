import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Pencil, Plus } from 'lucide-react';
import { PERSONAL_PROJECT_SLUG, PROJECT_STATUS_LABELS, previewOf, projectColorMap } from '@larvis/shared';
import { getLearnwebCourseByProjectId, listNotes, listProjects, listTodos, type TodoFilter } from '../lib/api';
import { useLiveQuery } from '../lib/useLive';
import { useMediaQuery } from '../lib/useMediaQuery';
import { MQ } from '../theme/breakpoints';
import { Badge, IconButton, Segmented } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { TodoList } from '../features/todos/TodoList';
import { NotesTree } from '../features/notes/NotesTree';
import { ProjectFormModal } from '../features/projects/ProjectFormModal';
import { ProjectOpenLinks } from '../features/projects/ProjectOpenLinks';
import { subtreeIds } from '../features/projects/counts';
import { CoursePanel } from '../features/learnweb/CoursePanel';
import { MODULES } from '../lib/modules';
import '../features/projects/projects.css';

type Tab = 'notes' | 'todos' | 'learnweb';
const TABS: readonly Tab[] = ['notes', 'todos', 'learnweb'];

/**
 * One project: its notes and todos side by side on the desktop, as tabs below.
 * Both cover the whole subtree — sub-projects' notes appear as folders, their
 * todos in the same list. The "Persönlich" project also holds everything without a project.
 */
export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const desktop = useMediaQuery(MQ.desktop);
  const [params, setParams] = useSearchParams();
  const { data: projects } = useLiveQuery(listProjects, ['projects'], [], 'projects');
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [descOpen, setDescOpen] = useState(false);

  // Verknüpfter Learnweb-Kurs (falls das Projekt aus einem Kurs erstellt wurde).
  // Nur mit eingeschaltetem Learnweb-Modul; sonst gibt es weder Abfrage noch Tab.
  const courseFetcher = useCallback(
    () => (id && MODULES.learnweb ? getLearnwebCourseByProjectId(id) : Promise.resolve(null)),
    [id],
  );
  const { data: course } = useLiveQuery(courseFetcher, ['learnweb_courses'], [id], `lw:course:project:${id}`);

  const all = projects ?? [];
  const project = all.find((p) => p.id === id);
  const colors = useMemo(() => projectColorMap(projects ?? []), [projects]);
  const ids = useMemo(() => (id && projects ? subtreeIds(projects, id) : id ? [id] : []), [projects, id]);
  const isPersonal = project?.slug === PERSONAL_PROJECT_SLUG;

  // Same filters (and cache keys) as NotesTree / TodoList below, for the tab counts.
  const todoFilter: TodoFilter = {
    ...(ids.length > 1 ? { projectIds: ids } : { projectId: id }),
    ...(isPersonal ? { includeUnassigned: true } : {}),
  };
  const todoKey = JSON.stringify(todoFilter);
  const todoFetcher = useCallback(() => listTodos(todoFilter), [todoKey]); // todoKey encodes the filter
  const { data: todos } = useLiveQuery(todoFetcher, ['todos'], [todoKey], `todos:${todoKey}`);
  const noteKey = `${ids.join(',')}${isPersonal ? '+none' : ''}`;
  const noteFetcher = useCallback(
    () => listNotes({ projectIds: ids, includeUnassigned: isPersonal }),
    [noteKey], // key encodes ids + isPersonal
  );
  const { data: notes } = useLiveQuery(noteFetcher, ['notes'], [noteKey], `notes:${noteKey}`);

  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) && (requested !== 'learnweb' || course) ? requested : 'notes';
  const setTab = (t: Tab) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === 'notes') next.delete('tab');
        else next.set('tab', t);
        return next;
      },
      { replace: true },
    );

  const directChildren = all.filter((p) => p.parent_id === id);
  const parent = project?.parent_id ? all.find((p) => p.id === project.parent_id) ?? null : null;

  if (projects && !project) {
    return (
      <div className="page">
        <p className="empty">Projekt nicht gefunden.</p>
        <Link to="/projects" className="btn">Zu den Projekten</Link>
      </div>
    );
  }
  if (!project) return <div className="page"><p className="empty">Lädt…</p></div>;

  const backTo = parent ? `/projects/${parent.id}` : '/projects';
  const defaults = { area: 'project' as const, project_id: project.id };

  const notesPane = (
    <NotesTree projectId={project.id} projectIds={ids} includeUnassigned={isPersonal} defaults={defaults} />
  );
  const todosPane = (
    <TodoList filter={todoFilter} defaults={defaults} emptyText="Keine offenen ToDos." />
  );

  return (
    <div className="page">
      <div className="project-head">
        <IconButton size="sm" label={parent ? `Zurück zu ${parent.name}` : 'Zurück zu den Projekten'} onClick={() => navigate(backTo)}>
          <ChevronLeft size={18} />
        </IconButton>
        <span className="project-head__swatch" style={{ background: colors.get(project.id) ?? 'var(--accent)' }} aria-hidden />
        <h1 className="page__title project-head__title">{isPersonal ? 'Persönlich' : project.name}</h1>
        {project.status !== 'active' && <Badge>{PROJECT_STATUS_LABELS[project.status]}</Badge>}
        <div className="project-head__actions">
          <ProjectOpenLinks localPath={project.local_path} />
          <IconButton label="Bearbeiten" onClick={() => setEditing(true)}>
            <Pencil size={18} />
          </IconButton>
        </div>
      </div>

      <div className="stack-section">
        {(project.description_md || parent) && (
          <div className="project-intro">
            {parent && (
              <div className="project-intro__parent">
                Unterprojekt von <Link to={`/projects/${parent.id}`}>{parent.name}</Link>
              </div>
            )}
            {project.description_md &&
              (descOpen ? (
                <div className="project-desc project-desc--open">
                  <Markdown>{project.description_md}</Markdown>
                  <button className="project-desc__toggle" onClick={() => setDescOpen(false)}>
                    Weniger
                  </button>
                </div>
              ) : (
                <button className="project-desc" onClick={() => setDescOpen(true)} title="Beschreibung aufklappen">
                  {previewOf(project.description_md)}
                </button>
              ))}
          </div>
        )}

        <div className="project-chips" aria-label="Unterprojekte">
          {directChildren.map((c) => (
            <button key={c.id} className="chip project-chip" onClick={() => navigate(`/projects/${c.id}`)}>
              <span className="project-chip__dot" style={{ background: colors.get(c.id) ?? 'var(--accent)' }} />
              {c.name}
            </button>
          ))}
          <button className="chip project-chip project-chip--add" onClick={() => setAddingSub(true)}>
            <Plus size={13} /> Unterprojekt
          </button>
        </div>

        {desktop ? (
          <div className="project-split">
            <div className="stack-section">
              {notesPane}
              {course && (
                <section>
                  <div className="section-title">Learnweb</div>
                  <CoursePanel course={course} />
                </section>
              )}
            </div>
            <aside className="project-split__side">
              <div className="section-title">ToDos</div>
              {todosPane}
            </aside>
          </div>
        ) : (
          <>
            <div>
              <Segmented
                options={[
                  { value: 'notes', label: `Notizen${notes ? ` (${notes.length})` : ''}` },
                  { value: 'todos', label: `ToDos${todos ? ` (${todos.length})` : ''}` },
                  ...(course ? [{ value: 'learnweb' as const, label: 'Learnweb' }] : []),
                ]}
                value={tab}
                onChange={setTab}
              />
            </div>
            {tab === 'notes' && notesPane}
            {tab === 'todos' && todosPane}
            {tab === 'learnweb' && course && <CoursePanel course={course} />}
          </>
        )}
      </div>

      {editing && <ProjectFormModal project={project} projects={all} open onClose={() => setEditing(false)} />}
      {addingSub && (
        <ProjectFormModal
          project={null}
          projects={all}
          open
          defaultParentId={project.id}
          onClose={() => setAddingSub(false)}
        />
      )}
    </div>
  );
}
