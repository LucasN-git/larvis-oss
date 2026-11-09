import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Paperclip, Plus } from 'lucide-react';
import { buildNoteTree, previewOf, projectColorMap, type Area, type Note, type NoteAttachment, type NoteNode, type Project } from '@larvis/shared';
import { listNoteAttachments, listNotes, listProjects, signedAttachmentUrl } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Button } from '../../components/ui';
import { attachmentIcon, formatBytes } from './attachmentUtil';
import { NoteEditorModal } from './NoteEditorModal';
import './notes.css';

/** Open an attachment's file in a new tab via a short-lived signed URL. */
async function openAttachment(att: NoteAttachment) {
  const url = await signedAttachmentUrl(att.storage_path).catch(() => null);
  if (url) window.open(url, '_blank', 'noopener');
}

type Defaults = { area?: Area; project_id?: string | null; parent_id?: string | null };

interface NotesTreeProps {
  projectId: string;
  /** The project plus its sub-projects (projectId first). Sub-projects become folders. */
  projectIds?: string[];
  /** Also show notes without a project at the root (the "Persönlich" project). */
  includeUnassigned?: boolean;
  defaults?: Defaults;
}

/**
 * Folder-tree view of a project's notes on the project page: the project's own
 * note tree at the root, then each sub-project from `projectIds` that holds
 * notes as a collapsible folder. A "folder" is just a note that has children.
 */
export function NotesTree({ projectId, projectIds, includeUnassigned = false, defaults }: NotesTreeProps) {
  const scopeIds = projectIds?.length ? projectIds : [projectId];
  const scopeKey = `${scopeIds.join(',')}${includeUnassigned ? '+none' : ''}`;
  const notesFetcher = useCallback(
    () => listNotes({ projectIds: scopeIds, includeUnassigned }),
    // scopeKey encodes scopeIds/includeUnassigned.
    [scopeKey],
  );
  // listNotes liefert von jeder Serie nur die aktuelle Version.
  const { data: notes, loading } = useLiveQuery(notesFetcher, ['notes'], [scopeKey], `notes:${scopeKey}`);
  const { data: projects } = useLiveQuery(listProjects, ['projects'], [], 'projects');
  const colors = useMemo(() => projectColorMap(projects ?? []), [projects]);
  const { data: attachments } = useLiveQuery(() => listNoteAttachments(), ['note_attachments'], [], 'note_attachments:all');

  // Attachments grouped by their note, ordered like the editor list.
  const attByNote = useMemo(() => {
    const m = new Map<string, NoteAttachment[]>();
    for (const a of attachments ?? []) {
      if (!m.has(a.note_id)) m.set(a.note_id, []);
      m.get(a.note_id)!.push(a);
    }
    return m;
  }, [attachments]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Note | null>(null);
  const [creating, setCreating] = useState<Defaults | null>(null);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const reveal = (id: string) => setExpanded((prev) => new Set(prev).add(id));
  const startCreate = (d: Defaults) => setCreating({ area: 'project', ...d });

  // Notes grouped by project.
  const grouped = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of notes ?? []) {
      const k = n.project_id ?? '∅';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    return m;
  }, [notes]);

  // Project page: the project's own notes form the root; sub-projects (in the
  // order of projectIds) that hold notes follow as folders.
  const scopedTree = useMemo(
    () => buildNoteTree((notes ?? []).filter((n) => n.project_id === projectId || (includeUnassigned && n.project_id === null))),
    [notes, projectId, includeUnassigned],
  );
  const subProjects = useMemo(() => {
    const byId = new Map((projects ?? []).map((p) => [p.id, p]));
    return scopeIds
      .filter((id) => id !== projectId && (grouped.get(id)?.length ?? 0) > 0)
      .map((id) => byId.get(id))
      .filter((p): p is Project => Boolean(p));
  }, [scopeKey, projectId, projects, grouped]);

  // Every collapsible id, for expand-all / collapse-all. A note is collapsible
  // when it has child notes or attachments.
  const foldableIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (nodes: NoteNode[]) =>
      nodes.forEach((n) => {
        if (n.children.length || (attByNote.get(n.id)?.length ?? 0) > 0) ids.push(n.id);
        walk(n.children);
      });
    walk(scopedTree);
    for (const p of subProjects) { ids.push(p.id); walk(buildNoteTree(grouped.get(p.id) ?? [])); }
    return ids;
  }, [scopedTree, subProjects, grouped, attByNote]);

  const allOpen = foldableIds.length > 0 && foldableIds.every((id) => expanded.has(id));
  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(foldableIds));

  const total = notes?.length ?? 0;

  function NoteRow({ node, depth }: { node: NoteNode; depth: number }) {
    const hasChildNotes = node.children.length > 0;
    const atts = attByNote.get(node.id) ?? [];
    // Attachments make a note expandable but must NOT turn it into a folder:
    // the folder icon is reserved for notes that contain child notes.
    const expandable = hasChildNotes || atts.length > 0;
    const isOpen = expanded.has(node.id);
    return (
      <>
        <div className="tree-row" style={{ paddingLeft: depth * 18 + 6 }}>
          <button
            className="tree-row__twist"
            onClick={() => expandable && toggle(node.id)}
            aria-label={expandable ? (isOpen ? 'Zuklappen' : 'Aufklappen') : undefined}
            tabIndex={expandable ? 0 : -1}
          >
            {expandable ? (
              isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />
            ) : (
              <span className="tree-row__spacer" />
            )}
          </button>
          {/* Ein gesetztes Emoji ersetzt Datei- und Ordnersymbol; der Pfeil zeigt weiter, ob aufklappbar. */}
          {node.icon ? (
            <span className="tree-row__icon tree-row__emoji" aria-hidden>{node.icon}</span>
          ) : hasChildNotes ? (
            isOpen ? (
              <FolderOpen size={16} className="tree-row__icon" />
            ) : (
              <Folder size={16} className="tree-row__icon" />
            )
          ) : (
            <FileText size={15} className="tree-row__icon tree-row__icon--file" />
          )}
          <button className="tree-row__label" onClick={() => setEditing(node)} title={previewOf(node.body_md)}>
            <span className="tree-row__title">{node.title || 'Ohne Titel'}</span>
            {hasChildNotes && <span className="tree-row__count">{node.children.length}</span>}
            {atts.length > 0 && (
              <span className="tree-row__attcount" title={`${atts.length} Anhang${atts.length === 1 ? '' : 'e'}`}>
                <Paperclip size={11} /> {atts.length}
              </span>
            )}
          </button>
          <button
            className="tree-row__add"
            aria-label="Unternotiz hinzufügen"
            title="Unternotiz hinzufügen"
            onClick={() => {
              reveal(node.id);
              startCreate({ project_id: node.project_id, parent_id: node.id });
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        {isOpen && node.children.map((c) => <NoteRow key={c.id} node={c} depth={depth + 1} />)}
        {isOpen &&
          atts.map((a) => {
            const Icon = attachmentIcon(a);
            return (
              <div key={a.id} className="tree-row tree-row--att" style={{ paddingLeft: (depth + 1) * 18 + 6 }}>
                <span className="tree-row__twist"><span className="tree-row__spacer" /></span>
                <Icon size={15} className="tree-row__icon tree-row__icon--file" />
                <button
                  className="tree-row__label"
                  onClick={() => void openAttachment(a)}
                  title={`${a.filename} · ${formatBytes(a.size_bytes)} · öffnen`}
                >
                  <span className="tree-row__title tree-row__title--att">{a.filename || 'Datei'}</span>
                </button>
              </div>
            );
          })}
      </>
    );
  }

  function ProjectRow({ project }: { project: Project }) {
    const tree = buildNoteTree(grouped.get(project.id) ?? []);
    const isOpen = expanded.has(project.id);
    return (
      <>
        <div className="tree-row tree-row--project" style={{ paddingLeft: 6 }}>
          <button className="tree-row__twist" onClick={() => toggle(project.id)} aria-label={isOpen ? 'Zuklappen' : 'Aufklappen'}>
            {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <span className="tree-row__dot" style={{ background: colors.get(project.id) ?? 'var(--accent)' }} />
          <button className="tree-row__label" onClick={() => toggle(project.id)}>
            <span className="tree-row__title tree-row__title--project">
              {project.icon ? `${project.icon} ` : ''}
              {project.name}
            </span>
            <span className="tree-row__count">{grouped.get(project.id)?.length ?? 0}</span>
          </button>
          <button
            className="tree-row__add"
            aria-label="Notiz in diesem Projekt"
            title="Notiz in diesem Projekt"
            onClick={() => {
              reveal(project.id);
              startCreate({ project_id: project.id, parent_id: null });
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        {isOpen && tree.map((n) => <NoteRow key={n.id} node={n} depth={1} />)}
      </>
    );
  }

  return (
    <div className="stack gap-md">
      <div className="row between center">
        <span className="section-title" style={{ margin: 0 }}>
          {notes ? `${total} ${total === 1 ? 'Notiz' : 'Notizen'}` : 'Notizen'}
        </span>
        <div className="row gap-sm center">
          {foldableIds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={toggleAll}>
              {allOpen ? 'Einklappen' : 'Aufklappen'}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => startCreate({ project_id: projectId, parent_id: null })}
          >
            <Plus size={16} /> Neu
          </Button>
        </div>
      </div>

      {notes && total === 0 && !loading && <div className="empty">Noch keine Notizen.</div>}

      {scopedTree.length + subProjects.length > 0 && (
        <div className="tree">
          {scopedTree.map((n) => <NoteRow key={n.id} node={n} depth={0} />)}
          {subProjects.map((p) => <ProjectRow key={p.id} project={p} />)}
        </div>
      )}

      {creating && (
        <NoteEditorModal note={null} open onClose={() => setCreating(null)} defaults={{ ...defaults, ...creating }} />
      )}
      {editing && <NoteEditorModal note={editing} open onClose={() => setEditing(null)} />}
    </div>
  );
}
