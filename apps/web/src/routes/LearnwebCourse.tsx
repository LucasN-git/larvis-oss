import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, FolderKanban } from 'lucide-react';
import { createProjectFromCourse, listLearnwebCourses } from '../lib/api';
import { useLiveQuery } from '../lib/useLive';
import { Button, IconButton } from '../components/ui';
import { useToast } from '../lib/toast';
import { SyncButton } from '../features/learnweb/SyncButton';
import { CoursePanel } from '../features/learnweb/CoursePanel';

export function LearnwebCourse() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { notify } = useToast();
  const moodleId = Number(id);
  const fetcher = useCallback(() => listLearnwebCourses(true), []);
  const { data: courses } = useLiveQuery(fetcher, ['learnweb_courses'], [], 'lw:courses:all');
  const [creating, setCreating] = useState(false);

  const course = courses?.find((c) => c.moodle_id === moodleId);

  const createProject = async () => {
    if (!course || creating) return;
    setCreating(true);
    try {
      const project = await createProjectFromCourse(course);
      notify(`Projekt „${project.name}" erstellt.`, 'saved');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Projekt konnte nicht erstellt werden.', 'error');
    } finally {
      setCreating(false);
    }
  };

  if (courses && !course) {
    return (
      <div className="page">
        <p className="empty">Kurs nicht im Cache.</p>
        <Link to="/learnweb" className="btn">Zu Learnweb</Link>
      </div>
    );
  }
  if (!course) {
    return (
      <div className="page">
        <p className="empty">Lädt…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row gap-sm center" style={{ marginBottom: 12 }}>
        <IconButton size="sm" label="Zurück" onClick={() => navigate('/learnweb')}>
          <ChevronLeft size={18} />
        </IconButton>
        <button className="item-row__sub" onClick={() => navigate('/learnweb')}>
          Learnweb
        </button>
      </div>

      <div className="page__header">
        <div>
          <h1 className="page__title">{course.fullname}</h1>
          {course.shortname && <div className="item-row__sub">{course.shortname}</div>}
        </div>
        <div className="row gap-sm center wrap lw-course-actions">
          {course.project_id ? (
            <Button variant="ghost" onClick={() => navigate(`/projects/${course.project_id}`)}>
              <FolderKanban size={16} /> Zum Projekt
            </Button>
          ) : (
            <Button variant="ghost" onClick={createProject} disabled={creating}>
              <FolderKanban size={16} /> {creating ? 'Erstelle…' : 'Projekt erstellen'}
            </Button>
          )}
          <SyncButton courseId={course.moodle_id} lastSyncedAt={course.last_synced_at} />
          <a href={course.url} target="_blank" rel="noreferrer">
            <IconButton label="In Learnweb öffnen">
              <ExternalLink size={18} />
            </IconButton>
          </a>
        </div>
      </div>

      <CoursePanel course={course} />
    </div>
  );
}
