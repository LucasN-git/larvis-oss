// Typed data access for the web app (client-side, anon key + RLS).
// The MCP server mirrors this surface server-side with the service-role key.
//
// Soft-Delete: Inhalte werden nie hart gelöscht. "Löschen" setzt `deleted_at`
// (Zeile bleibt in der DB, ist in der App aber nirgends sichtbar). Jede Lese-Query
// filtert `deleted_at is null`. Projekte & Notizen kennen zusätzlich eine Archiv-Stufe
// (Projekte: status='archived', Notizen: archived_at) — im Archiv sichtbar, sonst ausgeblendet.
import { supabase } from './supabase';
import { notifyLocalChange } from './useLive';
import { removeTodoEvent, syncTodoToCalendar } from './calendar';
import { todayDueIso } from './format';
import {
  buildProjectTree,
  defaultProjectPath,
  slugify,
  type Area,
  type Briefing,
  type Contact,
  type InboxItem,
  type Item,
  type Json,
  type LearnwebAnnouncement,
  type LearnwebCourse,
  type LearnwebEvent,
  type LearnwebItem,
  type LearnwebVideo,
  type LearnwebVideoStatus,
  type Learning,
  type LearningAttachment,
  type LearningSource,
  type Memory,
  type MemoryKind,
  type Note,
  type NoteAttachment,
  type Place,
  type Project,
  type Entry,
  type Todo,
} from '@larvis/shared';

/** Zeitstempel fürs Soft-Delete / Archivieren. */
const now = () => new Date().toISOString();

// Explicit column lists keep the heavy `search` tsvector out of results
// and keep the returned types aligned with the domain types.
const PROJECT_COLS =
  'id,parent_id,name,slug,description_md,status,color,icon,local_path,sort_order,created_at,updated_at,deleted_at';
const TODO_COLS =
  'id,project_id,area,title,body_md,status,priority,backlog,due_at,completed_at,tags,gcal_event_id,sort_order,created_at,updated_at,deleted_at';
const NOTE_COLS =
  'id,project_id,parent_id,area,title,body_md,tags,sort_order,created_at,updated_at,archived_at,deleted_at,' +
  'icon,series_id,version_no,previous_version_id,superseded_at,graph';
// Der Themen-Graph ist im Schema ein generisches jsonb (Json); die App arbeitet mit
// dem NoteGraph-Vertrag. Beim Schreiben wird nur der Typ übersetzt.
type NoteRowPatch = Omit<Partial<Note>, 'graph'> & { graph?: Json | null };
const noteRow = (patch: Partial<Note>) => patch as unknown as NoteRowPatch;
const ITEM_COLS = 'id,name,location,category,notes_md,area,project_id,tags,created_at,updated_at,deleted_at';

// ---- Projects ----------------------------------------------------------
/** Live-Projekte: nicht gelöscht, nicht archiviert. */
export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_COLS)
    .is('deleted_at', null)
    .neq('status', 'archived')
    .order('sort_order')
    .order('created_at')
    .returns<Project[]>();
  if (error) throw error;
  return data;
}

/** Archivierte Projekte (status='archived', nicht gelöscht) — für die Archiv-Seite. */
export async function listArchivedProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_COLS)
    .is('deleted_at', null)
    .eq('status', 'archived')
    .order('sort_order')
    .order('created_at')
    .returns<Project[]>();
  if (error) throw error;
  return data;
}

export async function listProjectTree() {
  return buildProjectTree(await listProjects());
}

export async function createProject(input: Partial<Project> & { name: string; slug: string }) {
  const { data, error } = await supabase.from('projects').insert(input).select(PROJECT_COLS).single();
  if (error) throw error;
  notifyLocalChange('projects');
  return data as unknown as Project;
}

export async function updateProject(id: string, patch: Partial<Project>) {
  const { error } = await supabase.from('projects').update(patch).eq('id', id);
  if (error) throw error;
  notifyLocalChange('projects');
}

/** Ins Archiv legen (aus dem Hauptbereich ausblenden, im Archiv wiederherstellbar). */
export async function archiveProject(id: string) {
  await updateProject(id, { status: 'archived' });
}

/** Aus dem Archiv zurückholen. */
export async function unarchiveProject(id: string) {
  await updateProject(id, { status: 'active' });
}

export async function deleteProject(id: string) {
  // Soft-Delete: Projekt verschwindet aus der App, bleibt in der DB. Todos/Notizen/Items
  // bleiben unangetastet (kein Cascade) und wandern nicht ins "ohne Projekt".
  const { error } = await supabase.from('projects').update({ deleted_at: now() }).eq('id', id);
  if (error) throw error;
  notifyLocalChange('projects');
}

// ---- Project scope (todos + notes) -------------------------------------
/**
 * Which project(s) a todo/note query covers. `projectIds` (a project plus its
 * sub-projects) wins over `projectId`; `includeUnassigned` adds the rows
 * without a project — the "Persönlich" project (slug `persoenlich`) is their home.
 */
export interface ProjectScope {
  projectId?: string | null;
  projectIds?: string[];
  includeUnassigned?: boolean;
}

// PostgREST `or`/`in` filter values: ids are uuids, so no quoting needed.
function applyProjectScope<Q extends { eq: Function; is: Function; in: Function; or: Function }>(q: Q, scope: ProjectScope): Q {
  const ids = scope.projectIds ?? (scope.projectId ? [scope.projectId] : undefined);
  if (ids) {
    if (scope.includeUnassigned) {
      return q.or(`project_id.in.(${ids.join(',')}),project_id.is.null`);
    }
    return q.in('project_id', ids);
  }
  if (scope.projectId === null) return q.is('project_id', null);
  return q;
}

// ---- Todos -------------------------------------------------------------
export interface TodoFilter extends ProjectScope {
  area?: Area;
  status?: Todo['status'];
  includeDone?: boolean;
  /** false = exclude backlog (default views), true = only backlog, undefined = all. */
  backlog?: boolean;
  /** Only todos for the Heute page: due today or overdue (undated todos are excluded). */
  forToday?: boolean;
}

export async function listTodos(filter: TodoFilter = {}): Promise<Todo[]> {
  let q = supabase.from('todos').select(TODO_COLS).is('deleted_at', null);
  if (filter.area) q = q.eq('area', filter.area);
  q = applyProjectScope(q, filter);
  if (filter.status) q = q.eq('status', filter.status);
  if (!filter.includeDone && !filter.status) q = q.neq('status', 'done');
  if (filter.backlog !== undefined) q = q.eq('backlog', filter.backlog);
  if (filter.forToday) {
    // Due today or overdue. Undated todos have due_at = null and are excluded
    // (null <= x is never true), which is what we want for the Heute list.
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    q = q.lte('due_at', end.toISOString());
  }
  const { data, error } = await q
    .order('priority', { ascending: false })
    .order('due_at', { nullsFirst: false })
    .order('sort_order')
    .returns<Todo[]>();
  if (error) throw error;
  return data;
}

// Mirror a todo into the Larvis calendar when it has a due date (or had an
// event that may now need updating/removing). Best-effort, never blocks.
function reconcileTodoEvent(todo: Todo) {
  if (todo.due_at || todo.gcal_event_id) void syncTodoToCalendar(todo);
}

export async function createTodo(input: Partial<Todo> & { title: string }) {
  const { data, error } = await supabase.from('todos').insert(input).select(TODO_COLS).single();
  if (error) throw error;
  const todo = data as unknown as Todo;
  notifyLocalChange('todos');
  reconcileTodoEvent(todo);
  return todo;
}

export async function updateTodo(id: string, patch: Partial<Todo>) {
  const { data, error } = await supabase.from('todos').update(patch).eq('id', id).select(TODO_COLS).single();
  if (error) throw error;
  const todo = data as unknown as Todo;
  notifyLocalChange('todos');
  reconcileTodoEvent(todo);
  return todo;
}

export async function setTodoDone(id: string, done: boolean) {
  await updateTodo(id, {
    status: done ? 'done' : 'todo',
    completed_at: done ? new Date().toISOString() : null,
  });
}

export async function setTodoBacklog(id: string, backlog: boolean) {
  await updateTodo(id, { backlog });
}

// "Heute" == fällig heute. Der Toggle plant das ToDo auf heute (all-day) oder
// nimmt das Datum wieder weg. Genau das gleiche wie ein Fälligkeitsdatum von heute.
export async function setTodoToday(id: string, today: boolean) {
  await updateTodo(id, { due_at: today ? todayDueIso() : null });
}

export async function deleteTodo(id: string) {
  // Soft-Delete: Grab the linked event id first, mark the row deleted, then clean up
  // the mirrored calendar entry (the todo is gone from every app view either way).
  const { data } = await supabase.from('todos').select('gcal_event_id').eq('id', id).maybeSingle();
  const { error } = await supabase.from('todos').update({ deleted_at: now() }).eq('id', id);
  if (error) throw error;
  notifyLocalChange('todos');
  const eventId = (data as { gcal_event_id: string | null } | null)?.gcal_event_id;
  if (eventId) void removeTodoEvent(eventId);
}

/** Undo of deleteTodo: clears deleted_at. deleteTodo already removed the mirrored
 *  calendar event, so the stale gcal_event_id is dropped and a dated todo gets a
 *  fresh event via the usual reconcile. */
export async function restoreTodo(id: string) {
  const { data, error } = await supabase
    .from('todos')
    .update({ deleted_at: null, gcal_event_id: null })
    .eq('id', id)
    .select(TODO_COLS)
    .single();
  if (error) throw error;
  const todo = data as unknown as Todo;
  notifyLocalChange('todos');
  reconcileTodoEvent(todo);
  return todo;
}

// ---- Notes -------------------------------------------------------------
/** Live-Notizen (nicht gelöscht, nicht archiviert), ohne `includeSuperseded` nur die aktuelle Version jeder Serie. */
export async function listNotes(
  filter: ProjectScope & { area?: Area; includeSuperseded?: boolean } = {},
): Promise<Note[]> {
  let q = supabase.from('notes').select(NOTE_COLS).is('deleted_at', null).is('archived_at', null);
  if (!filter.includeSuperseded) q = q.is('superseded_at', null);
  if (filter.area) q = q.eq('area', filter.area);
  q = applyProjectScope(q, filter);
  // Fetch order is irrelevant once buildNoteTree re-sorts by sort_order, but a
  // stable order keeps the flat list (e.g. parent pickers) deterministic.
  const { data, error } = await q
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .returns<Note[]>();
  if (error) throw error;
  return data;
}

/** Archivierte Notizen (archived_at gesetzt, nicht gelöscht) — für die Archiv-Seite. */
export async function listArchivedNotes(): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select(NOTE_COLS)
    .is('deleted_at', null)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
    .returns<Note[]>();
  if (error) throw error;
  return data;
}

export async function createNote(input: Partial<Note> = {}) {
  const { data, error } = await supabase.from('notes').insert(noteRow(input)).select(NOTE_COLS).single();
  if (error) throw error;
  notifyLocalChange('notes');
  return data as unknown as Note;
}

/** Re-parent a note in the folder tree (null = move to project root). */
export async function moveNote(id: string, parentId: string | null, sortOrder?: number) {
  const patch: Partial<Note> = { parent_id: parentId };
  if (sortOrder !== undefined) patch.sort_order = sortOrder;
  const { error } = await supabase.from('notes').update(noteRow(patch)).eq('id', id);
  if (error) throw error;
  notifyLocalChange('notes');
}

export async function updateNote(id: string, patch: Partial<Note>) {
  const { error } = await supabase.from('notes').update(noteRow(patch)).eq('id', id);
  if (error) throw error;
  notifyLocalChange('notes');
}

/** Notiz archivieren (aus dem Notizbaum ausblenden, im Archiv wiederherstellbar). */
export async function archiveNote(id: string) {
  await updateNote(id, { archived_at: now() });
}

/** Notiz aus dem Archiv zurückholen. */
export async function unarchiveNote(id: string) {
  await updateNote(id, { archived_at: null });
}

/** Alle nicht gelöschten Versionen einer Serie, aufsteigend nach version_no (auch archivierte). */
export async function listNoteSeries(seriesId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select(NOTE_COLS)
    .eq('series_id', seriesId)
    .is('deleted_at', null)
    .order('version_no', { ascending: true })
    .returns<Note[]>();
  if (error) throw error;
  return data;
}

/** Graph und Einfrier-Zeitpunkt einer Notiz, frisch aus der Datenbank. */
export async function getNoteGraphState(id: string): Promise<Pick<Note, 'graph' | 'superseded_at'>> {
  const { data, error } = await supabase.from('notes').select('graph,superseded_at').eq('id', id).single();
  if (error) throw error;
  return data as Pick<Note, 'graph' | 'superseded_at'>;
}

/** Felder, die der Editor beim Anlegen einer Version ungespeichert mitgeben kann. */
export type VersionOverrides = Partial<Pick<Note, 'title' | 'body_md' | 'tags' | 'icon' | 'graph'>>;

/**
 * Neue Version einer Notiz. Kopieren, Einfrieren der älteren Versionen und
 * Umhängen der Unternotizen laufen als eine Transaktion in der Datenbank
 * (Funktion create_note_version in der Migration); `overrides` ersetzen den
 * gespeicherten Stand der Vorlage in der Kopie.
 */
export async function createNoteVersion(template: Pick<Note, 'id'>, overrides: VersionOverrides = {}): Promise<Note> {
  const { data, error } = await supabase.rpc('create_note_version', {
    p_id: template.id,
    // Weggelassene Parameter (undefined) übernimmt die Funktion aus der Vorlage.
    p_title: overrides.title,
    p_body_md: overrides.body_md,
    p_tags: overrides.tags,
    p_icon: overrides.icon ?? undefined,
    p_graph: (overrides.graph ?? undefined) as Json | undefined,
  });
  if (error) throw error;
  notifyLocalChange('notes');
  return data as unknown as Note;
}

export async function deleteNote(id: string) {
  const { error } = await supabase.from('notes').update({ deleted_at: now() }).eq('id', id);
  if (error) throw error;
  notifyLocalChange('notes');
}

// ---- Note attachments --------------------------------------------------
// Files/images attached to a note. Binaries live in the private "note-files"
// bucket; the note_attachments row holds metadata + storage path. Access is
// only via short-lived signed URLs (the bucket is not public).
const NOTE_ATTACH_COLS =
  'id,note_id,storage_path,filename,mime_type,size_bytes,kind,inline,sort_order,created_at';
const NOTE_FILES_BUCKET = 'note-files';
const UPLOADS_BUCKET = 'uploads';

/** Anhänge einer Notiz, mehrerer Notizen (z. B. aller Versionen einer Serie) oder aller. */
export async function listNoteAttachments(noteId?: string | string[]): Promise<NoteAttachment[]> {
  let q = supabase.from('note_attachments').select(NOTE_ATTACH_COLS);
  if (Array.isArray(noteId)) q = q.in('note_id', noteId);
  else if (noteId) q = q.eq('note_id', noteId);
  const { data, error } = await q
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .returns<NoteAttachment[]>();
  if (error) throw error;
  return data;
}

/** File extension (lowercase, no dot) from a name or mime type. */
function extFor(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop()! : '';
  if (fromName) return fromName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  const fromMime = file.type.split('/')[1] ?? 'bin';
  return fromMime.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
}

/**
 * Upload a file into a private owner bucket. Path: <owner_uid>/<folder>/<uuid>.<ext> —
 * the first segment is the uid the storage RLS checks. Returns the metadata the
 * attachment row needs; the caller inserts the row and removes the object if that fails.
 * Shared by note and wiki attachments.
 */
async function uploadOwnerFile(bucket: string, folder: string, file: File) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Nicht angemeldet — Upload nicht möglich.');

  const path = `${uid}/${folder}/${crypto.randomUUID()}.${extFor(file)}`;
  const up = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw up.error;

  return {
    storage_path: path,
    filename: file.name || `datei.${extFor(file)}`,
    mime_type: file.type || 'application/octet-stream',
    size_bytes: file.size,
    kind: (file.type.startsWith('image/') ? 'image' : 'file') as NoteAttachment['kind'],
  };
}

/**
 * Upload a file and record it as an attachment of `noteId`.
 * `inline` marks pasted images that are embedded in the body.
 */
export async function uploadNoteAttachment(
  noteId: string,
  file: File,
  opts: { inline?: boolean } = {},
): Promise<NoteAttachment> {
  const meta = await uploadOwnerFile(NOTE_FILES_BUCKET, noteId, file);
  const { data, error } = await supabase
    .from('note_attachments')
    .insert({ note_id: noteId, ...meta, inline: opts.inline ?? false })
    .select(NOTE_ATTACH_COLS)
    .single();
  if (error) {
    // Row insert failed — don't leave the orphaned object behind.
    await supabase.storage.from(NOTE_FILES_BUCKET).remove([meta.storage_path]).catch(() => {});
    throw error;
  }
  notifyLocalChange('note_attachments');
  return data as unknown as NoteAttachment;
}

export async function updateNoteAttachment(id: string, patch: Partial<NoteAttachment>) {
  const { error } = await supabase.from('note_attachments').update(patch).eq('id', id);
  if (error) throw error;
  notifyLocalChange('note_attachments');
}

/** Delete an attachment: removes both the storage object and the metadata row. */
export async function deleteNoteAttachment(att: Pick<NoteAttachment, 'id' | 'storage_path'>) {
  await supabase.storage.from(NOTE_FILES_BUCKET).remove([att.storage_path]).catch(() => {});
  const { error } = await supabase.from('note_attachments').delete().eq('id', att.id);
  if (error) throw error;
  notifyLocalChange('note_attachments');
}

// Signed-URL cache: reuse a URL until it is within a minute of expiring (key: bucket/path).
const signedUrlCache = new Map<string, { url: string; exp: number }>();

/** Short-lived signed URL for an object in a private bucket (cached until near expiry). */
export async function signedUrl(bucket: string, storagePath: string, expiresIn = 3600): Promise<string> {
  const key = `${bucket}/${storagePath}`;
  const hit = signedUrlCache.get(key);
  const nowMs = Date.now();
  if (hit && hit.exp > nowMs + 60_000) return hit.url;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, expiresIn);
  if (error) throw error;
  signedUrlCache.set(key, { url: data.signedUrl, exp: nowMs + expiresIn * 1000 });
  return data.signedUrl;
}

/** Short-lived signed URL for a private note-file. */
export function signedAttachmentUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  return signedUrl(NOTE_FILES_BUCKET, storagePath, expiresIn);
}

/** Short-lived signed URL for a dump/entry upload. */
export function signedUploadUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  return signedUrl(UPLOADS_BUCKET, storagePath, expiresIn);
}

// ---- Learnings (kuratiertes Wiki) --------------------------------------
// Eigene Tabelle neben notes: andere Adresse (slug statt Projekt), andere Lebensdauer
// (keine Archiv-Stufe), eigene Lesesicht. Der Slug ist nach dem Anlegen unveränderlich.
const LEARNING_COLS =
  'id,area,parent_id,slug,title,summary,body_md,tags,sort_order,created_at,updated_at,deleted_at';
const LEARNING_SOURCE_COLS = 'id,learning_id,entry_id,note_id,role,comment,sort_order,created_at';
const LEARNING_ATTACH_COLS =
  'id,learning_id,storage_path,filename,mime_type,size_bytes,kind,inline,sort_order,created_at';
const LEARNING_FILES_BUCKET = 'learning-files';

/**
 * Alle Live-Seiten aller Bereiche, inklusive Body. Persönlicher Maßstab: eine Abfrage
 * speist Baum und Seitenansicht, der Baum wird clientseitig gebaut.
 */
export async function listLearnings(): Promise<Learning[]> {
  const { data, error } = await supabase
    .from('learnings')
    .select(LEARNING_COLS)
    .is('deleted_at', null)
    .order('area')
    .order('sort_order')
    .order('title')
    .returns<Learning[]>();
  if (error) throw error;
  return data;
}

export async function createLearning(
  input: Pick<Learning, 'slug' | 'area' | 'title'> &
    Partial<Pick<Learning, 'body_md' | 'summary' | 'parent_id' | 'tags' | 'sort_order'>>,
): Promise<Learning> {
  const { data, error } = await supabase.from('learnings').insert(input).select(LEARNING_COLS).single();
  if (error) throw error;
  notifyLocalChange('learnings');
  return data as unknown as Learning;
}

/** Slug bleibt fest — er ist die Adresse der Seite. */
export async function updateLearning(id: string, patch: Partial<Omit<Learning, 'id' | 'slug'>>) {
  const { error } = await supabase.from('learnings').update(patch).eq('id', id);
  if (error) throw error;
  notifyLocalChange('learnings');
}

/** Soft-Delete; Anhänge bleiben. Wiederherstellen über das MCP-Tool restore_learning. */
export async function deleteLearning(id: string) {
  await updateLearning(id, { deleted_at: now() });
}

/**
 * Alle Belege aller Seiten. Persönlicher Maßstab: eine Abfrage speist die Seitenansicht
 * („Belege") und die Einträge-Liste („fließt ein in"); gefiltert wird clientseitig.
 */
export async function listLearningSources(): Promise<LearningSource[]> {
  const { data, error } = await supabase
    .from('learning_sources')
    .select(LEARNING_SOURCE_COLS)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .returns<LearningSource[]>();
  if (error) throw error;
  return data;
}

/** Quelle an eine Seite hängen; dieselbe Quelle ein zweites Mal aktualisiert Rolle und Kommentar. */
export async function linkLearningSource(
  input: Pick<LearningSource, 'learning_id'> &
    ({ entry_id: string; note_id?: null } | { note_id: string; entry_id?: null }) &
    Partial<Pick<LearningSource, 'role' | 'comment' | 'sort_order'>>,
): Promise<LearningSource> {
  const onConflict = input.entry_id ? 'learning_id,entry_id' : 'learning_id,note_id';
  const { data, error } = await supabase
    .from('learning_sources')
    .upsert({ ...input, entry_id: input.entry_id ?? null, note_id: input.note_id ?? null }, { onConflict })
    .select(LEARNING_SOURCE_COLS)
    .single();
  if (error) throw error;
  notifyLocalChange('learning_sources');
  return data as unknown as LearningSource;
}

export async function updateLearningSource(id: string, patch: Partial<Pick<LearningSource, 'role' | 'comment' | 'sort_order'>>) {
  const { error } = await supabase.from('learning_sources').update(patch).eq('id', id);
  if (error) throw error;
  notifyLocalChange('learning_sources');
}

/** Verknüpfung lösen; Eintrag bzw. Notiz bleiben. */
export async function unlinkLearningSource(id: string) {
  const { error } = await supabase.from('learning_sources').delete().eq('id', id);
  if (error) throw error;
  notifyLocalChange('learning_sources');
}

/** Anhänge einer Seite, oder alle, wenn keine Seite angegeben ist (Seitenansicht ohne Extra-Fetch). */
export async function listLearningAttachments(learningId?: string): Promise<LearningAttachment[]> {
  let q = supabase.from('learning_attachments').select(LEARNING_ATTACH_COLS);
  if (learningId) q = q.eq('learning_id', learningId);
  const { data, error } = await q
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .returns<LearningAttachment[]>();
  if (error) throw error;
  return data;
}

export async function uploadLearningAttachment(
  learningId: string,
  file: File,
  opts: { inline?: boolean } = {},
): Promise<LearningAttachment> {
  const meta = await uploadOwnerFile(LEARNING_FILES_BUCKET, learningId, file);
  const { data, error } = await supabase
    .from('learning_attachments')
    .insert({ learning_id: learningId, ...meta, inline: opts.inline ?? false })
    .select(LEARNING_ATTACH_COLS)
    .single();
  if (error) {
    await supabase.storage.from(LEARNING_FILES_BUCKET).remove([meta.storage_path]).catch(() => {});
    throw error;
  }
  notifyLocalChange('learning_attachments');
  return data as unknown as LearningAttachment;
}

/** Delete a wiki attachment: removes both the storage object and the metadata row. */
export async function deleteLearningAttachment(att: Pick<LearningAttachment, 'id' | 'storage_path'>) {
  await supabase.storage.from(LEARNING_FILES_BUCKET).remove([att.storage_path]).catch(() => {});
  const { error } = await supabase.from('learning_attachments').delete().eq('id', att.id);
  if (error) throw error;
  notifyLocalChange('learning_attachments');
}

/** Short-lived signed URL for a wiki file (learning-files bucket). */
export function signedLearningFileUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  return signedUrl(LEARNING_FILES_BUCKET, storagePath, expiresIn);
}

// ---- Items (location of things) ---------------------------------------
export async function listItems(
  filter: { area?: Area; projectId?: string | null; query?: string } = {},
): Promise<Item[]> {
  let q = supabase.from('items').select(ITEM_COLS).is('deleted_at', null);
  if (filter.area) q = q.eq('area', filter.area);
  if (filter.projectId !== undefined) {
    q = filter.projectId === null ? q.is('project_id', null) : q.eq('project_id', filter.projectId);
  }
  if (filter.query) q = q.textSearch('search', filter.query, { type: 'websearch', config: 'simple' });
  const { data, error } = await q.order('name').returns<Item[]>();
  if (error) throw error;
  return data;
}

export async function upsertItem(input: Partial<Item> & { name: string }) {
  const { data, error } = await supabase.from('items').upsert(input).select(ITEM_COLS).single();
  if (error) throw error;
  notifyLocalChange('items');
  return data as unknown as Item;
}

export async function deleteItem(id: string) {
  const { error } = await supabase.from('items').update({ deleted_at: now() }).eq('id', id);
  if (error) throw error;
  notifyLocalChange('items');
}

// ---- Entries (die sortierte Sammlung, Tab „Inbox“) ------------------------
const ENTRY_COLS =
  'id,area,also_areas,name,url,description,category,tags,comment,notes_md,' +
  'source_platform,source_media_type,source_author,source_author_handle,source_title,' +
  'source_published_at,source_duration_seconds,source_word_count,source_page_count,' +
  'upload_id,captured_at,created_at,updated_at,deleted_at';
// Lesepfad mit Datei-Embed; der Upsert bleibt skalar (und schickt upload_id nie mit,
// überschreibt es also auch nicht).
const ENTRY_COLS_READ = `${ENTRY_COLS},upload:uploads(id,filename,mime_type,size_bytes,storage_path,created_at)`;

/** Alle lebenden Einträge, neueste zuerst; `query` läuft als Volltext über die DB, alles andere filtert die Liste selbst. */
export async function listEntries(filter: { query?: string } = {}): Promise<Entry[]> {
  let q = supabase.from('entries').select(ENTRY_COLS_READ).is('deleted_at', null);
  if (filter.query) q = q.textSearch('search', filter.query, { type: 'websearch', config: 'simple' });
  const { data, error } = await q.order('created_at', { ascending: false }).returns<Entry[]>();
  if (error) throw error;
  return data;
}

// `upload` ist ein Embed, keine Spalte — der Upsert nimmt ihn nicht an; upload_id bleibt
// unangetastet, weil der Editor es nie mitschickt.
export async function upsertEntry(input: Omit<Partial<Entry>, 'upload'> & { name: string; area: Entry['area'] }) {
  const { data, error } = await supabase.from('entries').upsert(input).select(ENTRY_COLS).single();
  if (error) throw error;
  notifyLocalChange('entries');
  return data as unknown as Entry;
}

export async function deleteEntry(id: string) {
  const { error } = await supabase.from('entries').update({ deleted_at: now() }).eq('id', id);
  if (error) throw error;
  notifyLocalChange('entries');
}

// ---- Memory (persistente Agent-Fakten) ----------------------------------
// Source of Truth für das, was Claude-Agenten über den Nutzer wissen sollen.
// scripts/memory/sync-claude-md.mjs kann alle Einträge in eine CLAUDE.md
// spiegeln. Bewusst Hard-Delete statt Soft-Delete: falsche
// Memories sollen nicht wiederherstellbar herumliegen.
const MEMORY_COLS = 'id,slug,title,content_md,kind,scope,created_at,updated_at';

export async function listMemories(filter: { kind?: MemoryKind } = {}): Promise<Memory[]> {
  let q = supabase.from('memories').select(MEMORY_COLS);
  if (filter.kind) q = q.eq('kind', filter.kind);
  const { data, error } = await q.order('updated_at', { ascending: false }).returns<Memory[]>();
  if (error) throw error;
  return data;
}

export async function upsertMemory(input: Partial<Memory> & { slug: string; title: string }) {
  const { data, error } = await supabase
    .from('memories')
    .upsert(input, { onConflict: 'slug' })
    .select(MEMORY_COLS)
    .single();
  if (error) throw error;
  notifyLocalChange('memories');
  return data as unknown as Memory;
}

export async function deleteMemory(id: string) {
  const { error } = await supabase.from('memories').delete().eq('id', id);
  if (error) throw error;
  notifyLocalChange('memories');
}

// ---- Contacts (persönliches Adressbuch) ----------------------------------
// Befüllt aus vCard-/LinkedIn-Export plus manueller Pflege; Geburtstage sind
// die Quelle für die Geburtstagsliste. Soft-Delete wie überall.
const CONTACT_COLS =
  'id,first_name,last_name,nickname,birthday,birthday_year_known,business,phones,emails,addresses,company,position,current_status,linkedin_url,links,tags,notes_md,source,created_at,updated_at,deleted_at';

export async function listContacts(): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select(CONTACT_COLS)
    .is('deleted_at', null)
    .order('first_name')
    .order('last_name')
    .returns<Contact[]>();
  if (error) throw error;
  return data;
}

export async function upsertContact(input: Partial<Contact>): Promise<Contact> {
  const { id, ...fields } = input;
  const q = id ? supabase.from('contacts').update(fields).eq('id', id) : supabase.from('contacts').insert(fields);
  const { data, error } = await q.select(CONTACT_COLS).single();
  if (error) throw error;
  notifyLocalChange('contacts');
  return data as unknown as Contact;
}

export async function deleteContact(id: string) {
  const { error } = await supabase.from('contacts').update({ deleted_at: now() }).eq('id', id);
  if (error) throw error;
  notifyLocalChange('contacts');
}

// ---- Places (Orte: Stammdaten für Termin-Orte) ---------------------------
// travel_minutes = Auto-Fahrzeit ab dem Heimatort (null = unbekannt oder innerorts);
// aliases erkennen den Ort in Freitext-Locations wieder (features/places/matchPlace).
// Der Name ist unter lebenden Orten eindeutig (ohne Groß-/Kleinschreibung).
const PLACE_COLS = 'id,name,address,city,travel_minutes,notes_md,aliases,created_at,updated_at,deleted_at';

export async function listPlaces(opts: { includeDeleted?: boolean } = {}): Promise<Place[]> {
  let q = supabase.from('places').select(PLACE_COLS);
  if (!opts.includeDeleted) q = q.is('deleted_at', null);
  const { data, error } = await q.order('name').returns<Place[]>();
  if (error) throw error;
  return data;
}

export async function upsertPlace(
  input: Partial<Omit<Place, 'created_at' | 'updated_at' | 'deleted_at'>> & { name: string },
): Promise<Place> {
  const { id, ...fields } = input;
  const q = id ? supabase.from('places').update(fields).eq('id', id) : supabase.from('places').insert(fields);
  const { data, error } = await q.select(PLACE_COLS).single();
  if (error) throw error;
  notifyLocalChange('places');
  return data as unknown as Place;
}

export async function deletePlace(id: string) {
  const { error } = await supabase.from('places').update({ deleted_at: now() }).eq('id', id);
  if (error) throw error;
  notifyLocalChange('places');
}

/** Undo of deletePlace. Fails when a live place with the same name exists meanwhile (unique index). */
export async function restorePlace(id: string) {
  const { error } = await supabase.from('places').update({ deleted_at: null }).eq('id', id);
  if (error) throw error;
  notifyLocalChange('places');
}

// ---- Learnweb (Moodle-Cache, read-only gefüllt vom Sync) ----------------
// Der Tab liest ausschließlich diese Cache-Tabellen; es wird nie direkt mit
// Learnweb gesprochen. Video-Listen laden bewusst NICHT transcript_md/segments
// (können je Vorlesung hunderte KB sein) — nur der Transkript-Viewer lädt sie.
const LW_COURSE_COLS =
  'id,moodle_id,project_id,fullname,shortname,url,startdate,enddate,visible,content_hash,last_synced_at,first_seen_at,created_at,updated_at,deleted_at';
const LW_ITEM_COLS =
  'id,course_id,cmid,section_id,section_name,subsection_name,modtype,type_label,name,url,size_text,sort_order,first_seen_at,last_seen_at,created_at,updated_at,deleted_at';
const LW_VIDEO_LIST_COLS =
  'id,course_id,item_id,episode_key,kind,title,duration_seconds,recorded_at,episode_url,preview_url,sort_order,status,model,transcribed_at,error,first_seen_at,created_at,updated_at,deleted_at';
const LW_VIDEO_FULL_COLS = `${LW_VIDEO_LIST_COLS},transcript_md,segments`;
const LW_ANNOUNCEMENT_COLS =
  'id,course_id,discussion_id,subject,author,posted_at,body_text,url,pinned,first_seen_at,created_at,updated_at,deleted_at';
const LW_EVENT_COLS =
  'id,event_id,course_id,name,modulename,starts_at,url,created_at,updated_at,deleted_at';

/** Video-Zusammenfassung ohne die großen Transkript-Spalten (für Listen). */
export type LearnwebVideoSummary = Omit<LearnwebVideo, 'transcript_md' | 'segments'>;

export async function listLearnwebCourses(includePast = false): Promise<LearnwebCourse[]> {
  let q = supabase.from('learnweb_courses').select(LW_COURSE_COLS).is('deleted_at', null);
  if (!includePast) q = q.or(`enddate.is.null,enddate.gt.${now()}`);
  const { data, error } = await q.order('fullname', { ascending: true }).returns<LearnwebCourse[]>();
  if (error) throw error;
  return data;
}

/** Der zu einem Projekt verknüpfte Kurs (für den Learnweb-Tab im Projekt). */
export async function getLearnwebCourseByProjectId(projectId: string): Promise<LearnwebCourse | null> {
  const { data, error } = await supabase
    .from('learnweb_courses')
    .select(LW_COURSE_COLS)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as LearnwebCourse) ?? null;
}

export async function getLearnwebCourseByMoodleId(moodleId: number): Promise<LearnwebCourse | null> {
  const { data, error } = await supabase
    .from('learnweb_courses')
    .select(LW_COURSE_COLS)
    .eq('moodle_id', moodleId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as LearnwebCourse) ?? null;
}

export async function listLearnwebItems(courseId: string): Promise<LearnwebItem[]> {
  const { data, error } = await supabase
    .from('learnweb_items')
    .select(LW_ITEM_COLS)
    .eq('course_id', courseId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .returns<LearnwebItem[]>();
  if (error) throw error;
  return data;
}

export async function listLearnwebAnnouncements(courseId: string): Promise<LearnwebAnnouncement[]> {
  const { data, error } = await supabase
    .from('learnweb_announcements')
    .select(LW_ANNOUNCEMENT_COLS)
    .eq('course_id', courseId)
    .is('deleted_at', null)
    .order('posted_at', { ascending: false, nullsFirst: false })
    .returns<LearnwebAnnouncement[]>();
  if (error) throw error;
  return data;
}

export async function listLearnwebVideos(courseId?: string): Promise<LearnwebVideoSummary[]> {
  let q = supabase.from('learnweb_videos').select(LW_VIDEO_LIST_COLS).is('deleted_at', null);
  if (courseId) q = q.eq('course_id', courseId);
  const { data, error } = await q
    .order('recorded_at', { ascending: false, nullsFirst: false })
    .returns<LearnwebVideoSummary[]>();
  if (error) throw error;
  return data;
}

/** Volles Video inkl. Transkript-Spalten (nur wenn der Viewer geöffnet wird). */
export async function getLearnwebVideo(id: string): Promise<LearnwebVideo | null> {
  const { data, error } = await supabase
    .from('learnweb_videos')
    .select(LW_VIDEO_FULL_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as LearnwebVideo) ?? null;
}

export async function listLearnwebEvents(): Promise<LearnwebEvent[]> {
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { data, error } = await supabase
    .from('learnweb_events')
    .select(LW_EVENT_COLS)
    .is('deleted_at', null)
    .gte('starts_at', since)
    .order('starts_at', { ascending: true })
    .returns<LearnwebEvent[]>();
  if (error) throw error;
  return data;
}

/** HTML-Entities aus Moodle-Namen dekodieren (&amp; &quot; …). */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Projektname aus dem Kurs-Fullname: Dozenten-Anhang (alles ab erstem Komma) weg. */
export function projectNameFromCourse(course: Pick<LearnwebCourse, 'fullname'>): string {
  return decodeEntities(course.fullname).split(',')[0].trim();
}

/**
 * Projekt aus einem Learnweb-Kurs erstellen und verknüpfen. Legt das Projekt
 * (Name ohne Dozenten-Anhang, Slug, Standard-Arbeitsordner, Kurs-Link in der
 * Beschreibung) plus einen "Vorlesungen"-Notizordner an und setzt
 * learnweb_courses.project_id. Den lokalen Ordner legt man selbst an.
 */
export async function createProjectFromCourse(course: LearnwebCourse): Promise<Project> {
  const name = projectNameFromCourse(course);
  const description = [
    `Learnweb-Kurs: [${decodeEntities(course.fullname)}](${course.url})`,
    course.shortname ? `Kürzel: ${course.shortname}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
  const base = {
    name,
    description_md: description,
    local_path: defaultProjectPath(slugify(name)),
  };
  let project: Project;
  try {
    project = await createProject({ ...base, slug: slugify(name) });
  } catch {
    project = await createProject({ ...base, slug: `${slugify(name)}-${Date.now().toString(36).slice(-4)}` });
  }

  const { error } = await supabase
    .from('learnweb_courses')
    .update({ project_id: project.id })
    .eq('id', course.id);
  if (error) throw error;

  // Start-Struktur für Vorlesungsnotizen; weitere Ordner legt man nach Bedarf an.
  await createNote({
    project_id: project.id,
    area: 'project',
    title: 'Vorlesungen',
    body_md: '',
  }).catch(() => undefined);

  notifyLocalChange('learnweb_courses');
  return project;
}

/** Kurs mit einem bestehenden Projekt verknüpfen (oder mit null lösen). */
export async function linkLearnwebCourseProject(courseId: string, projectId: string | null): Promise<void> {
  const { error } = await supabase
    .from('learnweb_courses')
    .update({ project_id: projectId })
    .eq('id', courseId);
  if (error) throw error;
  notifyLocalChange('learnweb_courses');
}

const TRANSCRIPT_PLACEHOLDER = '_Noch kein Transkript — im Videos-Tab „Transkribieren" anstoßen._';

/**
 * Vorlesungsnotiz im verknüpften Projekt anlegen (Ordner „Vorlesungen" → eine
 * Notiz je Video, Transkript als eigener Abschnitt). Existiert die Notiz schon,
 * wird nur ein inzwischen fertiges Transkript in den Platzhalter nachgetragen.
 * Liefert die Notiz plus was passiert ist (für den Toast).
 */
export async function upsertLectureNote(
  course: LearnwebCourse,
  video: Pick<LearnwebVideoSummary, 'id' | 'title' | 'episode_url' | 'recorded_at' | 'duration_seconds' | 'status' | 'sort_order'>,
): Promise<{ note: Note; action: 'created' | 'transcript_added' | 'unchanged' }> {
  if (!course.project_id) throw new Error('Kurs ist mit keinem Projekt verknüpft.');
  const projectId = course.project_id;
  const notes = await listNotes({ projectId });

  let folder = notes.find((n) => !n.parent_id && n.title === 'Vorlesungen');
  if (!folder) {
    folder = await createNote({ project_id: projectId, area: 'project', title: 'Vorlesungen', body_md: '' });
  }

  const transcript =
    video.status === 'done' ? (await getLearnwebVideo(video.id))?.transcript_md?.trim() || null : null;

  const existing = notes.find((n) => n.parent_id === folder!.id && n.title === video.title);
  if (existing) {
    // Transkript nachtragen, wenn es inzwischen fertig ist und der Platzhalter noch drinsteht.
    if (transcript && existing.body_md.includes(TRANSCRIPT_PLACEHOLDER)) {
      const body = existing.body_md.replace(TRANSCRIPT_PLACEHOLDER, transcript);
      await updateNote(existing.id, { body_md: body });
      return { note: { ...existing, body_md: body }, action: 'transcript_added' };
    }
    return { note: existing, action: 'unchanged' };
  }

  const meta = [
    video.recorded_at && `Aufgezeichnet: ${new Date(`${video.recorded_at}T12:00:00Z`).toLocaleDateString('de-DE')}`,
    video.duration_seconds && `Dauer: ${Math.round(video.duration_seconds / 60)} min`,
  ]
    .filter(Boolean)
    .join(' · ');
  const body = [
    `Vorlesung: [${video.title}](${video.episode_url})`,
    meta,
    '',
    '## Meine Notizen',
    '',
    '',
    '## Transkript',
    '',
    transcript ?? TRANSCRIPT_PLACEHOLDER,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const note = await createNote({
    project_id: projectId,
    area: 'project',
    parent_id: folder.id,
    title: video.title,
    body_md: body,
    sort_order: video.sort_order,
  });
  return { note, action: 'created' };
}

/** Ein Video zur lokalen Transkription vormerken (setzt nur den Status im Cache). */
export async function queueLearnwebTranscription(id: string): Promise<void> {
  const { error } = await supabase
    .from('learnweb_videos')
    .update({ status: 'queued' as LearnwebVideoStatus, error: null })
    .eq('id', id);
  if (error) throw error;
  notifyLocalChange('learnweb_videos');
}

// ---- Inbox (quick-capture "dump") ------------------------------------
const INBOX_COLS =
  'id,content,note,processed,scanned_at,scan_note,upload_id,created_at,processed_at,deleted_at,' +
  'upload:uploads(id,filename,mime_type,size_bytes,storage_path,created_at)';
// Obergrenze pro Objekt im Supabase-Free-Plan (und file_size_limit des Buckets).
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function listInbox(includeProcessed = false): Promise<InboxItem[]> {
  let q = supabase
    .from('inbox')
    .select(INBOX_COLS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (!includeProcessed) q = q.eq('processed', false);
  const { data, error } = await q.returns<InboxItem[]>();
  if (error) throw error;
  return data;
}

/** note: eigener Kommentar, warum man es aufhebt (optional; leer → null). */
export async function addInboxItem(content: string, note?: string) {
  const { error } = await supabase.from('inbox').insert({ content, note: note?.trim() || null });
  if (error) throw error;
  notifyLocalChange('inbox');
}

export async function resolveInboxItem(id: string, processed = true) {
  const { error } = await supabase
    .from('inbox')
    .update({ processed, processed_at: processed ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
  notifyLocalChange('inbox');
}

export async function deleteInboxItem(id: string) {
  const { error } = await supabase.from('inbox').update({ deleted_at: now() }).eq('id', id);
  if (error) throw error;
  notifyLocalChange('inbox');
}

/**
 * Datei in den Dump werfen: Objekt in den privaten Bucket uploads
 * (<owner_uid>/<upload_id>.<ext>), dann eine uploads-Zeile, dann das Dump-Item, das
 * darauf zeigt. Schlägt ein Schritt fehl, werden die vorherigen zurückgenommen. Der
 * Eintrag, den Claude später daraus macht, zeigt auf dieselbe uploads-Zeile. content
 * ist nie leer (Spalte not null; Briefing und Karte lesen sie): Dateiname als Fallback.
 */
export async function uploadInboxFile(file: File, content?: string, note?: string) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} ist zu groß (max. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`);
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Nicht angemeldet — Upload nicht möglich.');

  const id = crypto.randomUUID();
  const ext = extFor(file);
  const path = `${uid}/${id}.${ext}`;
  const up = await supabase.storage
    .from(UPLOADS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw up.error;

  const meta = await supabase.from('uploads').insert({
    id,
    storage_path: path,
    filename: file.name || `datei.${ext}`,
    mime_type: file.type || 'application/octet-stream',
    size_bytes: file.size,
  });
  if (meta.error) {
    await supabase.storage.from(UPLOADS_BUCKET).remove([path]).catch(() => {});
    throw meta.error;
  }

  const item = await supabase.from('inbox').insert({
    content: content?.trim() || file.name || `datei.${ext}`,
    note: note?.trim() || null,
    upload_id: id,
  });
  if (item.error) {
    await supabase.from('uploads').delete().eq('id', id);
    await supabase.storage.from(UPLOADS_BUCKET).remove([path]).catch(() => {});
    throw item.error;
  }
  notifyLocalChange('inbox');
}

// ---- Briefings ---------------------------------------------------------
const BRIEFING_COLS = 'id,date,content_md,model,read_at,created_at';

/** Neuestes Tages-Briefing (vom Cron erzeugt), oder null solange keins existiert. */
export async function getLatestBriefing(): Promise<Briefing | null> {
  const { data, error } = await supabase
    .from('briefings')
    .select(BRIEFING_COLS)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle<Briefing>();
  if (error) throw error;
  return data;
}

/** Alle Briefings, neuestes zuerst (Historie im Tab Profil). */
export async function listBriefings(): Promise<Briefing[]> {
  const { data, error } = await supabase
    .from('briefings')
    .select(BRIEFING_COLS)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data as unknown as Briefing[]) ?? [];
}

/** Haken auf der BriefingCard: als gelesen markieren, Card verschwindet. */
export async function markBriefingRead(id: string) {
  const { error } = await supabase.from('briefings').update({ read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  notifyLocalChange('briefings');
}

// ---- Helpers ----------------------------------------------------------
export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_COLS)
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Project) ?? null;
}

/** All distinct tags used across todos, notes, items and entries (for tag suggestions). */
export async function listTags(): Promise<string[]> {
  const [t, n, i, en] = await Promise.all([
    supabase.from('todos').select('tags').is('deleted_at', null),
    supabase.from('notes').select('tags').is('deleted_at', null),
    supabase.from('items').select('tags').is('deleted_at', null),
    supabase.from('entries').select('tags').is('deleted_at', null),
  ]);
  const all = new Set<string>();
  for (const res of [t.data, n.data, i.data, en.data]) {
    for (const row of res ?? []) for (const tag of row.tags ?? []) all.add(tag);
  }
  return [...all].sort((a, b) => a.localeCompare(b));
}
