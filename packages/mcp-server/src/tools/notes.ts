import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { titleFromMarkdown } from '@larvis/shared';
import { db } from '../supabase.js';
import { fail, guard, ok, unwrap } from '../util.js';
import { FROZEN_VERSION_MESSAGE, noteGraphSchema } from '../noteVersions.js';

const COLS =
  'id,project_id,parent_id,area,title,body_md,tags,sort_order,created_at,updated_at,archived_at,deleted_at,' +
  'icon,series_id,version_no,previous_version_id,superseded_at,graph';
const VERSION_LIST_COLS = 'id,title,version_no,created_at,superseded_at,icon';

// Vertrag für Claude-Skills: Format und Regeln des Themen-Graphen, in create_note/update_note gleich.
const GRAPH_DOC =
  'graph (optional, null removes it) is a topic map drawn interactively in the app: ' +
  '{ nodes: [{ id, label, group?, note?, weight?, x?, y? }], edges: [{ from, to, label? }], groups?: { <group>: <legend label> } }. ' +
  'Rules: at least one node; node ids unique (stable kebab-case keys); edges only between existing node ids, directed, label = short relation ("treibt", "ersetzt", "Gegenbild zu"); ' +
  'group is free text (same group = same colour, groups gives the legend text); note = 1–3 sentences of Markdown shown on click; weight 1–5 sets node size (default 3); ' +
  'x/y are optional positions saved by dragging in the app — omit them to let the auto-layout place nodes, and keep existing ones when rewriting a graph. ' +
  'icon (optional, null removes it) is one emoji (or very short text) shown instead of the generic note icon.';

const iconInput = z.string().trim().min(1).max(16).nullable().optional();
const graphInput = noteGraphSchema.nullable().optional();
const ATTACH_COLS =
  'id,note_id,storage_path,filename,mime_type,size_bytes,kind,inline,sort_order,created_at';
const NOTE_FILES_BUCKET = 'note-files';

export function registerNoteTools(server: McpServer) {
  server.registerTool(
    'list_notes',
    {
      title: 'List notes',
      description:
        'List notes, filterable by area / project. Soft-deleted notes are hidden unless include_deleted; archived notes are hidden unless include_archived; ' +
        'older, frozen versions of a versioned note (superseded_at set) are hidden unless include_superseded — list_note_versions shows a whole series.',
      inputSchema: {
        area: z.enum(['project', 'personal']).optional(),
        project_id: z.string().nullable().optional(),
        include_deleted: z.boolean().optional(),
        include_archived: z.boolean().optional(),
        include_superseded: z.boolean().optional(),
      },
    },
    async ({ area, project_id, include_deleted, include_archived, include_superseded }) =>
      guard(async () => {
        let q = db.from('notes').select(COLS);
        if (!include_deleted) q = q.is('deleted_at', null);
        if (!include_archived) q = q.is('archived_at', null);
        if (!include_superseded) q = q.is('superseded_at', null);
        if (area) q = q.eq('area', area);
        if (project_id !== undefined) q = project_id === null ? q.is('project_id', null) : q.eq('project_id', project_id);
        return ok(unwrap(await q.order('updated_at', { ascending: false })));
      }),
  );

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description:
        'Full-text search across note titles and bodies. Excludes soft-deleted notes and, unless include_superseded, older frozen versions of a versioned note.',
      inputSchema: { query: z.string(), include_superseded: z.boolean().optional() },
    },
    async ({ query, include_superseded }) =>
      guard(async () => {
        let q = db.from('notes').select(COLS).is('deleted_at', null);
        if (!include_superseded) q = q.is('superseded_at', null);
        return ok(unwrap(await q.textSearch('search', query, { type: 'websearch', config: 'simple' })));
      }),
  );

  server.registerTool(
    'get_note',
    {
      title: 'Get note',
      description:
        'Get one note by id (also finds archived / soft-deleted ones and frozen older versions). Includes icon, graph and the version fields series_id, version_no, previous_version_id, superseded_at (null = current version).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => guard(async () => ok(unwrap(await db.from('notes').select(COLS).eq('id', id).single()))),
  );

  server.registerTool(
    'create_note',
    {
      title: 'Create note',
      description:
        'Create a markdown note. Title derived from body if omitted. parent_id nests the note under another note of the same project (folder tree). ' +
        'A new note starts its own version series (version_no 1). ' +
        GRAPH_DOC,
      inputSchema: {
        body_md: z.string(),
        title: z.string().optional(),
        area: z.enum(['project', 'personal']).optional(),
        project_id: z.string().nullable().optional(),
        parent_id: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        icon: iconInput,
        graph: graphInput,
      },
    },
    async (args) =>
      guard(async () => {
        const title = args.title?.trim() || titleFromMarkdown(args.body_md, 'Notiz');
        return ok(unwrap(await db.from('notes').insert({ ...args, title }).select(COLS).single()));
      }),
  );

  server.registerTool(
    'update_note',
    {
      title: 'Update note',
      description:
        'Update fields of a note. parent_id (re-)nests the note in the folder tree (null = top level). ' +
        'An older version of a versioned note (superseded_at set) is frozen and refused unless force:true — to change a standpoint, create a new version with create_note_version and update that. ' +
        GRAPH_DOC,
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        body_md: z.string().optional(),
        tags: z.array(z.string()).optional(),
        project_id: z.string().nullable().optional(),
        parent_id: z.string().nullable().optional(),
        icon: iconInput,
        graph: graphInput,
        force: z.boolean().optional(),
      },
    },
    async ({ id, force, ...patch }) =>
      guard(async () => {
        if (!force) {
          const cur = unwrap(await db.from('notes').select('id,superseded_at').eq('id', id).single()) as {
            superseded_at: string | null;
          };
          if (cur.superseded_at) return fail(FROZEN_VERSION_MESSAGE);
        }
        return ok(unwrap(await db.from('notes').update(patch).eq('id', id).select(COLS).single()));
      }),
  );

  server.registerTool(
    'create_note_version',
    {
      title: 'Create note version',
      description:
        'Start a new version of a long-lived note instead of overwriting it — for notes that carry a standpoint over time (e.g. a yearly review or a long-running position paper), so the old wording stays readable. ' +
        'Copies the current version (title, body_md, tags, project, parent, area, icon, graph, sort_order) into a new note of the same series with version_no + 1 and previous_version_id = id, ' +
        'freezes the source (superseded_at = now; frozen versions are read-only for update_note) and returns the new note. Sub-notes (children of the source, not deleted) move to the new version; attachments are NOT copied and stay with the old one. ' +
        'Workflow: create_note_version first, then change the returned note with update_note. title optionally renames the new version. ' +
        'Refused if id is not the current (highest not-deleted) version of its series or is deleted; the error names the current one. Runs as one database transaction.',
      inputSchema: { id: z.string(), title: z.string().optional() },
    },
    async ({ id, title }) =>
      guard(async () => {
        // Kopieren, Einfrieren und Umhängen laufen als eine Transaktion in der Datenbank
        // (Funktion create_note_version); Ablehnungen kommen als Fehlermeldung von dort.
        const created = unwrap(await db.rpc('create_note_version', { p_id: id, p_title: title })) as { id: string };
        return ok(unwrap(await db.from('notes').select(COLS).eq('id', created.id).single()));
      }),
  );

  server.registerTool(
    'list_note_versions',
    {
      title: 'List note versions',
      description:
        'List all versions of the series a note belongs to (pass the id of any version), oldest first: id, title, version_no, created_at, superseded_at (null = current version), icon. ' +
        'Use it to read how a standpoint developed; get_note reads a single version in full.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        const note = unwrap(await db.from('notes').select('series_id').eq('id', id).single()) as { series_id: string };
        return ok(
          unwrap(
            await db
              .from('notes')
              .select(VERSION_LIST_COLS)
              .eq('series_id', note.series_id)
              .is('deleted_at', null)
              .order('version_no', { ascending: true }),
          ),
        );
      }),
  );

  server.registerTool(
    'archive_note',
    {
      title: 'Archive note',
      description: 'Move a note to the archive: hidden from the notes tree, still visible in the app archive.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('notes').update({ archived_at: new Date().toISOString() }).eq('id', id));
        return ok({ archived: id });
      }),
  );

  server.registerTool(
    'unarchive_note',
    {
      title: 'Unarchive note',
      description: 'Bring a note back from the archive into the active notes tree.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('notes').update({ archived_at: null }).eq('id', id));
        return ok({ unarchived: id });
      }),
  );

  server.registerTool(
    'delete_note',
    {
      title: 'Delete note',
      description: 'Soft-delete a note: disappears from the app but stays in the database (recoverable via restore_note).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', id));
        return ok({ deleted: id });
      }),
  );

  server.registerTool(
    'restore_note',
    {
      title: 'Restore note',
      description: 'Undo a soft-delete: bring a deleted note back into the app.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('notes').update({ deleted_at: null }).eq('id', id));
        return ok({ restored: id });
      }),
  );

  server.registerTool(
    'list_note_attachments',
    {
      title: 'List note attachments',
      description:
        'List the files/images attached to a note (metadata + a temporary signed download URL, ~1h). kind="image" with inline=true are screenshots embedded in the note body. Read-only — uploads happen in the web app.',
      inputSchema: { note_id: z.string() },
    },
    async ({ note_id }) =>
      guard(async () => {
        const rows = unwrap(
          await db
            .from('note_attachments')
            .select(ATTACH_COLS)
            .eq('note_id', note_id)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true }),
        ) as Array<{ storage_path: string }>;
        const withUrls = await Promise.all(
          rows.map(async (r) => {
            const { data } = await db.storage.from(NOTE_FILES_BUCKET).createSignedUrl(r.storage_path, 3600);
            return { ...r, signed_url: data?.signedUrl ?? null };
          }),
        );
        return ok(withUrls);
      }),
  );
}
