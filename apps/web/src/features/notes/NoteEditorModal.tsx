import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CopyPlus, Snowflake, Trash2 } from 'lucide-react';
import {
  PERSONAL_PROJECT_SLUG,
  buildNoteTree,
  descendantIds,
  flattenNoteTree,
  removeInlineImage,
  selectableProjects,
  titleFromMarkdown,
  type Area,
  type Note,
  type NoteAttachment,
  type NoteGraph,
  type Project,
} from '@larvis/shared';
import {
  archiveNote,
  createNote,
  createNoteVersion,
  deleteNote,
  deleteNoteAttachment,
  listNoteAttachments,
  listNoteSeries,
  listNotes,
  listProjects,
  signedAttachmentUrl,
  updateNote,
  uploadNoteAttachment,
} from '../../lib/api';
import { useAutosave } from '../../lib/useAutosave';
import { useToast } from '../../lib/toast';
import { Drawer } from '../../components/Drawer';
import { Markdown } from '../../components/Markdown';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { Modal } from '../../components/Modal';
import { Button, SaveStatus, Segmented, TextInput } from '../../components/ui';
import { NoteAttachments } from './NoteAttachments';
import { NoteDiffView } from './NoteDiffView';
import { NoteIconField } from './NoteIconField';
import { NoteVersionBar } from './NoteVersionBar';
import { useLearningRenderers } from '../learnings/learningMarkdown';
import { currentNotesOnly, currentOfSeries, initialNoteMode, versionDate, type NoteMode } from './noteVersions';
import './notes.css';

// React Flow ist groß und wird nur für Notizen mit Graph gebraucht → eigener Chunk.
const NoteGraphView = lazy(() => import('./NoteGraphView'));
// Während der Bestätigungsdialog offen ist, reagiert das Panel nicht auf Escape, Backdrop oder X.
const NOOP = () => {};

type ViewMode = NoteMode | 'diff';

interface Props {
  note: Note | null; // null = new
  open: boolean;
  onClose: () => void;
  defaults?: { area?: Area; project_id?: string | null; parent_id?: string | null };
}

/**
 * Notiz-Panel. Die Hülle merkt sich, welche Notiz gerade gezeigt wird: der Wechsel
 * auf eine andere Version der Serie (Versionsleiste, „Neue Version", Sprung aus
 * einer eingefrorenen Version) baut den Editor mit frischem Zustand neu auf.
 */
export function NoteEditorModal({ note, open, onClose, defaults = {} }: Props) {
  const [shown, setShown] = useState<{ note: Note | null; mode?: ViewMode }>({ note });
  return (
    <NoteEditor
      key={shown.note?.id ?? 'new'}
      note={shown.note}
      startMode={shown.mode}
      open={open}
      onClose={onClose}
      defaults={defaults}
      onOpenNote={(n, mode) => setShown({ note: n, mode })}
    />
  );
}

function NoteEditor({
  note,
  startMode,
  open,
  onClose,
  defaults,
  onOpenNote,
}: Props & { defaults: NonNullable<Props['defaults']>; startMode?: ViewMode; onOpenNote: (note: Note, mode?: ViewMode) => void }) {
  const { saved, notify } = useToast();
  const frozen = Boolean(note?.superseded_at);
  const [mode, setMode] = useState<ViewMode>(() => startMode ?? initialNoteMode(note));
  const [icon, setIcon] = useState(note?.icon ?? '');
  const [graph, setGraph] = useState<NoteGraph | null>(note?.graph ?? null);
  const [series, setSeries] = useState<Note[]>([]);
  const [seriesAttachments, setSeriesAttachments] = useState<NoteAttachment[]>([]);
  const [compareId, setCompareId] = useState('');
  const [confirmVersion, setConfirmVersion] = useState(false);
  const [versionBusy, setVersionBusy] = useState(false);
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body_md ?? '');
  const [tags, setTags] = useState((note?.tags ?? []).join(', '));
  const [projectId, setProjectId] = useState<string | null>(note?.project_id ?? defaults.project_id ?? null);
  const [parentId, setParentId] = useState<string | null>(note?.parent_id ?? defaults.parent_id ?? null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allNotes, setAllNotes] = useState<Note[] | null>(null); // null = not loaded yet
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const idRef = useRef(note?.id ?? null);

  // Current values for the async note-create path (avoids stale closures).
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const stateRef = useRef({ title, body, tags, projectId, parentId, icon });
  stateRef.current = { title, body, tags, projectId, parentId, icon };

  useEffect(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps);
        // Notes always belong to a project — default to "Persönlich" if none chosen.
        setProjectId((cur) => cur ?? ps.find((p) => p.slug === PERSONAL_PROJECT_SLUG)?.id ?? ps[0]?.id ?? null);
      })
      .catch(() => {});
    // Mit eingefrorenen Versionen, damit ein Elternverweis auf eine alte Version
    // unten auf deren aktuelle Version umgelenkt werden kann.
    listNotes({ includeSuperseded: true }).then(setAllNotes).catch(() => {});
    if (note?.id) listNoteAttachments(note.id).then(setAttachments).catch(() => {});
  }, [note?.id]);

  // Alle Versionen der Serie (für Leiste, Sprung zur aktuellen Version, Vergleich)
  // und deren Anhänge: kopierte Bildverweise zeigen auf Dateien älterer Versionen.
  useEffect(() => {
    if (!note?.series_id) return;
    let alive = true;
    listNoteSeries(note.series_id)
      .then(async (rows) => {
        if (!alive) return;
        setSeries(rows);
        const others = rows.map((r) => r.id).filter((id) => id !== note.id);
        if (others.length) {
          const atts = await listNoteAttachments(others);
          if (alive) setSeriesAttachments(atts);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [note?.id, note?.series_id]);

  const currentVersion = useMemo(() => currentOfSeries(series), [series]);
  const olderVersions = useMemo(
    () => (note ? series.filter((n) => n.version_no < note.version_no) : []),
    [series, note],
  );
  // Anhänge aller Versionen der Serie: eine neue Version kopiert den Text samt Bildverweisen,
  // die Dateien bleiben an der Version, in der sie eingefügt wurden.
  const { renderImage } = useLearningRenderers(
    useMemo(() => [...attachments, ...seriesAttachments], [attachments, seriesAttachments]),
    undefined,
    signedAttachmentUrl,
  );

  // Candidate parent folders: notes in the same project, minus self + own
  // descendants (no cycles). Indented by tree depth.
  const parentOptions = useMemo(() => {
    if (!projectId || !allNotes) return [];
    const inProject = currentNotesOnly(allNotes.filter((n) => n.project_id === projectId));
    const flat = flattenNoteTree(buildNoteTree(inProject));
    const blocked = idRef.current ? descendantIds(inProject, idRef.current) : new Set<string>();
    return flat
      .filter(({ node }) => node.id !== idRef.current && !blocked.has(node.id))
      .map(({ node, depth }) => ({ id: node.id, label: `${'  '.repeat(depth)}${node.title || 'Ohne Titel'}` }));
  }, [allNotes, projectId]);

  // If the chosen parent isn't valid for the current project, fall back to root.
  // Must wait for allNotes: against the not-yet-loaded list every parent looks
  // invalid, and the autosave would silently move the note to the project root.
  useEffect(() => {
    if (!allNotes) return;
    if (!parentId || parentOptions.some((o) => o.id === parentId)) return;
    // Zeigt der Verweis auf eine eingefrorene Version, gilt deren aktuelle Version als Ordner.
    const old = allNotes.find((n) => n.id === parentId);
    const current = old?.superseded_at
      ? allNotes.find((n) => n.series_id === old.series_id && !n.superseded_at)
      : undefined;
    setParentId(current && parentOptions.some((o) => o.id === current.id) ? current.id : null);
  }, [allNotes, parentOptions, parentId]);

  // Create the note on demand (first upload into an unsaved note). A shared
  // promise makes concurrent callers (paste + autosave) reuse one create.
  const creatingRef = useRef<Promise<string> | null>(null);
  const ensureNoteId = useCallback(async (): Promise<string> => {
    if (idRef.current) return idRef.current;
    if (creatingRef.current) return creatingRef.current;
    const p = (async () => {
      const s = stateRef.current;
      const pid = s.projectId ?? projectsRef.current.find((pr) => pr.slug === PERSONAL_PROJECT_SLUG)?.id ?? projectsRef.current[0]?.id ?? null;
      const created = await createNote({
        title: s.title.trim() || titleFromMarkdown(s.body, 'Notiz'),
        body_md: s.body,
        tags: s.tags.split(',').map((t) => t.trim()).filter(Boolean),
        project_id: pid,
        parent_id: s.parentId,
        area: 'project',
        icon: s.icon.trim() || null,
      });
      idRef.current = created.id;
      return created.id;
    })();
    creatingRef.current = p;
    return p;
  }, []);

  const { state, flush } = useAutosave({
    value: { title, body, tags, projectId, parentId, icon },
    // Eingefrorene Versionen werden nur gelesen, nie gespeichert.
    enabled: !frozen,
    canSave: () => !frozen && Boolean(title.trim() || body.trim()),
    onSaved: saved,
    onSave: async () => {
      const pid = projectId ?? projects.find((p) => p.slug === PERSONAL_PROJECT_SLUG)?.id ?? null;
      const payload = {
        title: title.trim() || titleFromMarkdown(body, 'Notiz'),
        body_md: body,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        project_id: pid,
        parent_id: parentId,
        area: 'project' as Area,
        icon: icon.trim() || null,
      };
      const id = idRef.current ?? (await ensureNoteId());
      await updateNote(id, payload);
    },
  });

  // Inline screenshot paste: upload as an inline image attachment.
  const uploadImage = useCallback(async (file: File) => {
    try {
      const id = await ensureNoteId();
      const row = await uploadNoteAttachment(id, file, { inline: true });
      setAttachments((prev) => [...prev, row]);
      return { id: row.id, filename: row.filename };
    } catch {
      return null;
    }
  }, [ensureNoteId]);

  const handleUploadDocs = useCallback(async (files: File[]) => {
    const id = await ensureNoteId();
    for (const f of files) {
      const row = await uploadNoteAttachment(id, f, { inline: false });
      setAttachments((prev) => [...prev, row]);
    }
  }, [ensureNoteId]);

  const handleDeleteAttachment = useCallback(async (att: NoteAttachment) => {
    await deleteNoteAttachment(att);
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    if (att.inline) setBody((b) => removeInlineImage(b, att.id));
  }, []);

  // „Neue Version": offenen Stand speichern, dann kopieren und die Kopie im Editor öffnen.
  async function handleNewVersion() {
    if (!note || frozen) return;
    setVersionBusy(true);
    try {
      await flush();
      const created = await createNoteVersion(note, {
        title: title.trim() || titleFromMarkdown(body, 'Notiz'),
        body_md: body,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        icon: icon.trim() || null,
        graph,
      });
      setConfirmVersion(false);
      onOpenNote(created, 'edit');
    } catch (e) {
      notify((e as { message?: string } | null)?.message || 'Neue Version fehlgeschlagen', 'error');
    } finally {
      setVersionBusy(false);
    }
  }

  async function openVersion(target: Note) {
    if (!note?.series_id) return;
    try {
      if (!frozen) await flush();
      const fresh = (await listNoteSeries(note.series_id)).find((r) => r.id === target.id);
      if (fresh) onOpenNote(fresh);
    } catch (e) {
      notify((e as { message?: string } | null)?.message || 'Version konnte nicht geladen werden', 'error');
    }
  }

  // Der Graph öffnet als Vollbild-Ebene; Schließen kehrt zur vorherigen Ansicht zurück.
  const modeBeforeGraph = useRef<ViewMode>(mode === 'graph' ? 'read' : mode);
  const changeMode = (next: ViewMode) => {
    if (next === 'graph' && mode !== 'graph') modeBeforeGraph.current = mode;
    setMode(next);
  };
  const closeGraph = useCallback(() => setMode(modeBeforeGraph.current), []);

  const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
  const modeOptions = [
    { value: 'read' as ViewMode, label: 'Lesen' },
    ...(frozen ? [] : [{ value: 'edit' as ViewMode, label: 'Bearbeiten' }]),
    { value: 'graph' as ViewMode, label: 'Graph' },
  ];
  const isCurrent = Boolean(note) && !frozen;

  return (
    <Drawer
      open={open}
      onClose={confirmVersion ? NOOP : onClose}
      title={note ? (frozen ? `Notiz · Version ${note.version_no}` : 'Notiz') : 'Neue Notiz'}
      footer={
        <>
          {note && (
            <div className="row gap-sm center" style={{ marginRight: 'auto' }}>
              <Button variant="ghost" onClick={async () => { await archiveNote(note.id); onClose(); }}>
                <Archive size={16} /> Archivieren
              </Button>
              <Button variant="ghost" onClick={async () => { await deleteNote(note.id); onClose(); }} style={{ color: 'var(--danger)' }}>
                <Trash2 size={16} /> Löschen
              </Button>
            </div>
          )}
          {!frozen && <SaveStatus state={state} />}
          <Button variant="primary" onClick={onClose}>Fertig</Button>
        </>
      }
    >
      {note && series.length > 1 && (
        <NoteVersionBar
          series={series}
          activeId={note.id}
          isCurrent={isCurrent}
          comparing={mode === 'diff'}
          onOpen={(n) => void openVersion(n)}
          onCompare={() => setMode((m) => (m === 'diff' ? initialNoteMode(note) : 'diff'))}
          onNewVersion={() => setConfirmVersion(true)}
        />
      )}
      {note && frozen && (
        <div className="note-frozen" role="status">
          <Snowflake size={15} />
          <span>
            Version {note.version_no} vom {versionDate(note)}, eingefroren –
          </span>
          {currentVersion && currentVersion.id !== note.id && (
            <button type="button" className="note-frozen__link" onClick={() => void openVersion(currentVersion)}>
              aktuelle Version öffnen →
            </button>
          )}
        </div>
      )}
      <div className="note-head">
        <NoteIconField value={icon} onChange={setIcon} readOnly={frozen} />
        <Segmented<ViewMode> options={modeOptions} value={mode} onChange={changeMode} className="note-head__modes" />
        {isCurrent && series.length <= 1 && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmVersion(true)} className="note-head__new">
            <CopyPlus size={14} /> Neue Version
          </Button>
        )}
      </div>

      {mode === 'read' && (
        <div className="stack gap-sm note-read">
          <h2 className="note-read__title">{title.trim() || titleFromMarkdown(body, 'Ohne Titel')}</h2>
          {body.trim() ? (
            <Markdown renderImage={renderImage}>{body}</Markdown>
          ) : (
            <div className="empty">Noch kein Text.</div>
          )}
          {tagList.length > 0 && (
            <div className="row gap-xs wrap">
              {tagList.map((t) => (
                <span key={t} className="chip">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'graph' &&
        (graph && note ? (
          <Suspense fallback={<div className="empty">Graph lädt…</div>}>
            <div className="empty">Graph ist im Vollbild geöffnet.</div>
            <NoteGraphView
              noteId={note.id}
              graph={graph}
              readOnly={frozen}
              onGraphChange={setGraph}
              title={`${icon ? `${icon} ` : ''}${title.trim() || titleFromMarkdown(body, 'Notiz')}`}
              onClose={closeGraph}
            />
          </Suspense>
        ) : (
          <div className="empty">Noch kein Graph – Claude kann einen anlegen.</div>
        ))}

      {mode === 'diff' && note && (
        <NoteDiffView
          current={note}
          currentBody={body}
          older={olderVersions}
          compareId={compareId}
          onCompareId={setCompareId}
        />
      )}

      {mode === 'edit' && !frozen && (
      <div className="stack gap-sm">
        <TextInput placeholder="Titel (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        {/* wrap: auf schmalen Screens stapeln sich Projekt/Ordner statt zu quetschen */}
        <div className="row gap-sm wrap" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="section-title" style={{ margin: '0 0 8px' }}>Projekt</div>
            <select className="input" value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)}>
              {selectableProjects(projects, projectId).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="section-title" style={{ margin: '0 0 8px' }}>Ordner</div>
            <select className="input" value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
              <option value="">— Projekt-Wurzel —</option>
              {parentOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <MarkdownEditor value={body} onChange={setBody} uploadImage={uploadImage} />
        <NoteAttachments attachments={attachments} onUpload={handleUploadDocs} onDelete={handleDeleteAttachment} />
        <TextInput placeholder="Tags, kommagetrennt" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      )}

      <Modal
        open={confirmVersion}
        onClose={() => !versionBusy && setConfirmVersion(false)}
        title="Neue Version anlegen?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmVersion(false)} disabled={versionBusy}>Abbrechen</Button>
            <Button variant="primary" onClick={() => void handleNewVersion()} disabled={versionBusy}>
              {versionBusy ? 'Legt an…' : 'Neue Version'}
            </Button>
          </>
        }
      >
        <p>
          Die Notiz wird als Version {(series.reduce((m, n) => Math.max(m, n.version_no), note?.version_no ?? 1)) + 1} kopiert
          und öffnet zum Bearbeiten. Version {note?.version_no ?? 1} bleibt danach eingefroren und nur lesbar.
        </p>
      </Modal>
    </Drawer>
  );
}
