import { useMemo } from 'react';
import { ArchiveRestore, FileText, FolderTree, Trash2 } from 'lucide-react';
import { previewOf, projectColorMap, type Note, type Project } from '@larvis/shared';
import {
  deleteNote,
  deleteProject,
  listArchivedNotes,
  listArchivedProjects,
  listProjects,
  unarchiveNote,
  unarchiveProject,
} from '../lib/api';
import { useLiveQuery } from '../lib/useLive';
import { Button, IconButton } from '../components/ui';
import './personal.css';

// Archiv: archivierte Projekte und Notizen. Wiederherstellen holt sie zurück in den
// Hauptbereich; "Löschen" ist die Stufe darunter (Soft-Delete) — dann sind sie nur noch
// in der Datenbank, nicht mehr in der App (auch nicht hier).
export function Archive() {
  const { data: projects } = useLiveQuery(listArchivedProjects, ['projects'], [], 'archived-projects');
  const { data: notes } = useLiveQuery(listArchivedNotes, ['notes'], [], 'archived-notes');
  // Nur für die Projekt-Zuordnung der Notizen (Live-Projekte).
  const { data: liveProjects } = useLiveQuery(listProjects, ['projects'], [], 'projects');

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of [...(liveProjects ?? []), ...(projects ?? [])]) m.set(p.id, p.name);
    return m;
  }, [liveProjects, projects]);
  // Wirksame Farbe: ein archiviertes Unterprojekt ohne eigene Farbe erbt die des Elternprojekts.
  const colors = useMemo(() => projectColorMap([...(liveProjects ?? []), ...(projects ?? [])]), [liveProjects, projects]);

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Archiv</h1>
      </div>

      <div className="stack-section">
        <p className="muted" style={{ margin: 0 }}>
          Archivierte Projekte und Notizen. „Wiederherstellen" holt sie zurück, „Löschen" verschiebt sie in die
          gelöschten Daten (nur noch in der Datenbank, über Claude wiederherstellbar).
        </p>

        <section>
          <div className="section-title">{projects ? `Projekte (${projects.length})` : 'Projekte'}</div>
          {projects && (
            <div className="group group--glyph">
              {projects.length === 0 && <div className="group__empty">Keine archivierten Projekte.</div>}
              {projects.map((p) => (
                <ProjectRow key={p.id} project={p} color={colors.get(p.id)} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="section-title">{notes ? `Notizen (${notes.length})` : 'Notizen'}</div>
          {notes && (
            <div className="group group--glyph">
              {notes.length === 0 && <div className="group__empty">Keine archivierten Notizen.</div>}
              {notes.map((n) => (
                <NoteRow key={n.id} note={n} project={n.project_id ? projectName.get(n.project_id) : undefined} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Eine Zeile in der Archiv-Gruppe: Symbol, Titel/Vorschau, Aktionen. Auf dem
// Handy brechen die Aktionen unter den Titel um (item-row--wrap).
function ArchiveRow({
  icon,
  color,
  title,
  subtitle,
  onRestore,
  onDelete,
}: {
  icon: React.ReactNode;
  color?: string | null;
  title: string;
  subtitle?: string;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="item-row item-row--wrap">
      <span className="row-glyph" style={color ? { color } : undefined}>
        {icon}
      </span>
      <div className="item-row__main">
        <div className="item-row__title">{title}</div>
        {subtitle && <div className="item-row__sub">{subtitle}</div>}
      </div>
      <div className="item-row__actions">
        <Button variant="ghost" size="sm" onClick={onRestore}>
          <ArchiveRestore size={16} /> Wiederherstellen
        </Button>
        <IconButton size="sm" variant="bare" label="Löschen" onClick={onDelete} style={{ color: 'var(--danger)' }}>
          <Trash2 size={16} />
        </IconButton>
      </div>
    </div>
  );
}

function ProjectRow({ project, color }: { project: Project; color?: string | null }) {
  return (
    <ArchiveRow
      icon={<FolderTree size={17} />}
      color={color}
      title={project.name}
      subtitle={project.description_md ? previewOf(project.description_md) : undefined}
      onRestore={() => void unarchiveProject(project.id)}
      onDelete={() => void deleteProject(project.id)}
    />
  );
}

function NoteRow({ note, project }: { note: Note; project?: string }) {
  const preview = previewOf(note.body_md);
  return (
    <ArchiveRow
      icon={<FileText size={16} />}
      title={note.title || 'Ohne Titel'}
      subtitle={[project, preview].filter(Boolean).join(' · ') || undefined}
      onRestore={() => void unarchiveNote(note.id)}
      onDelete={() => void deleteNote(note.id)}
    />
  );
}
