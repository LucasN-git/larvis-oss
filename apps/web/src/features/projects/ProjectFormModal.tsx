import { useRef, useState } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import {
  PROJECT_PALETTE,
  effectiveProjectColor,
  firstUnusedPaletteColor,
  isProjectActive,
  slugify,
  type Project,
  type ProjectStatus,
} from '@larvis/shared';
import { archiveProject, createProject, deleteProject, updateProject } from '../../lib/api';
import { useAutosave } from '../../lib/useAutosave';
import { useToast } from '../../lib/toast';
import { Drawer } from '../../components/Drawer';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { Button, SaveStatus, Segmented, TextInput } from '../../components/ui';

// Farbe eines neuen Projekts, solange keine gewählt ist: Unterprojekte erben
// (null), Hauptprojekte bekommen die erste noch freie Palettenfarbe.
function defaultColor(parentId: string | null, projects: Project[]): string | null {
  return parentId ? null : firstUnusedPaletteColor(projects);
}

function swatchStyle(fill: string, selected: boolean, dashed = false) {
  const base = { width: 30, height: 30, borderRadius: '50%', background: fill };
  // "Erbt": gestrichelter Rahmen statt Ring, ausgewählt in der geerbten Farbe.
  if (dashed)
    return {
      ...base,
      outline: `2px dashed ${selected ? fill : 'var(--text-faint)'}`,
      outlineOffset: selected ? 3 : 2,
    };
  return { ...base, boxShadow: selected ? '0 0 0 3px var(--bg), 0 0 0 5px ' + fill : 'var(--shadow-ring)' };
}

interface Props {
  project: Project | null; // null = new
  projects: Project[]; // for parent selection
  open: boolean;
  onClose: () => void;
  defaultParentId?: string | null;
}

export function ProjectFormModal({ project, projects, open, onClose, defaultParentId = null }: Props) {
  const { saved } = useToast();
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description_md ?? '');
  const [parentId, setParentId] = useState<string | null>(project?.parent_id ?? defaultParentId);
  // null = erbt die Farbe des Elternprojekts. Eine bestehende null bleibt null:
  // Autosave schreibt nur eine Farbe, die der Nutzer selbst gewählt hat.
  const [color, setColor] = useState<string | null>(() =>
    project ? project.color : defaultColor(parentId, projects),
  );
  // Ohne bewusste Farbwahl in dieser Sitzung folgt die Farbe dem Elternprojekt.
  const colorPicked = useRef(false);
  const pickColor = (c: string | null) => {
    colorPicked.current = true;
    setColor(c);
  };
  const changeParent = (next: string | null) => {
    setParentId(next);
    if (colorPicked.current) return;
    if (!parentId && next) setColor(null);
    else if (!next && color === null) setColor(project?.color ?? firstUnusedPaletteColor(projects.filter((p) => p.id !== project?.id)));
  };
  const inherited = parentId ? effectiveProjectColor(projects, parentId) : null;
  const [localPath, setLocalPath] = useState(project?.local_path ?? '');
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'active');
  const idRef = useRef(project?.id ?? null);

  const { state } = useAutosave({
    value: { name, description, parentId, color, localPath, status },
    canSave: () => Boolean(name.trim()),
    onSaved: saved,
    onSave: async () => {
      const base = {
        name: name.trim(),
        description_md: description,
        parent_id: parentId,
        color,
        local_path: localPath.trim() || null,
        status,
      };
      if (idRef.current) {
        await updateProject(idRef.current, base);
      } else {
        let created: Project;
        try {
          created = await createProject({ ...base, slug: slugify(name) });
        } catch {
          created = await createProject({ ...base, slug: `${slugify(name)}-${Date.now().toString(36).slice(-4)}` });
        }
        idRef.current = created.id;
      }
    },
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={project ? 'Projekt bearbeiten' : 'Neues Projekt'}
      footer={
        <>
          {project && (
            <div className="row gap-sm center" style={{ marginRight: 'auto' }}>
              <Button
                variant="ghost"
                onClick={async () => {
                  await archiveProject(project.id);
                  onClose();
                }}
              >
                <Archive size={16} /> Archivieren
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await deleteProject(project.id);
                  onClose();
                }}
                style={{ color: 'var(--danger)' }}
              >
                <Trash2 size={16} /> Löschen
              </Button>
            </div>
          )}
          <SaveStatus state={state} />
          <Button variant="primary" onClick={onClose}>
            Fertig
          </Button>
        </>
      }
    >
      <div className="stack gap-sm">
        <TextInput placeholder="Projektname" value={name} onChange={(e) => setName(e.target.value)} />

        <Segmented
          options={[
            { value: 'active', label: 'Aktiv' },
            { value: 'paused', label: 'Inaktiv' },
          ]}
          value={isProjectActive({ status }) ? 'active' : 'paused'}
          onChange={(v) => setStatus(v)}
        />

        <div className="row gap-sm wrap">
          {parentId && (
            <button
              type="button"
              aria-label="Erbt – Farbe vom Elternprojekt"
              title={`Erbt vom Elternprojekt${inherited ? '' : ' (keine Farbe)'}`}
              aria-pressed={color === null}
              onClick={() => pickColor(null)}
              style={{
                ...swatchStyle(inherited ?? 'var(--well)', color === null, true),
                display: 'grid',
                placeItems: 'center',
                padding: 0,
                fontSize: 9,
                fontWeight: 700,
                color: inherited ? '#fff' : 'var(--text-muted)',
                textShadow: inherited ? '0 0 2px rgba(0,0,0,.6)' : undefined,
              }}
            >
              Erbt
            </button>
          )}
          {PROJECT_PALETTE.map((c) => (
            <button
              key={c.hex}
              type="button"
              aria-label={`Farbe ${c.label}`}
              title={c.label}
              aria-pressed={color?.toUpperCase() === c.hex}
              onClick={() => pickColor(c.hex)}
              style={swatchStyle(c.hex, color?.toUpperCase() === c.hex)}
            />
          ))}
        </div>

        <select
          className="input"
          value={parentId ?? ''}
          onChange={(e) => changeParent(e.target.value || null)}
        >
          <option value="">Kein übergeordnetes Projekt</option>
          {projects
            .filter((p) => p.id !== project?.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>

        <TextInput
          placeholder="Lokaler Ordnerpfad (z. B. /home/ich/projekte/beispiel)"
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />

        <MarkdownEditor value={description} onChange={setDescription} placeholder="Beschreibung (Markdown)…" />
      </div>
    </Drawer>
  );
}
