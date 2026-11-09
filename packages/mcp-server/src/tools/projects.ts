import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PROJECT_PALETTE, projectColorMap, slugify } from '@larvis/shared';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';

const COLS =
  'id,parent_id,name,slug,description_md,status,color,icon,local_path,sort_order,created_at,updated_at,deleted_at';

const PALETTE_HEXES = PROJECT_PALETTE.map((c) => `${c.hex} (${c.label})`).join(', ');

type ColorRow = { id: string; parent_id: string | null; color: string | null };

/**
 * Hängt jeder Zeile die wirksame Farbe an: die eigene oder, bei einem Unterprojekt ohne
 * Farbe, die vom Elternprojekt geerbte. Grundlage ist die volle Liste der lebenden Projekte,
 * damit auch ein gefiltertes Ergebnis die Farbe eines nicht mitgelieferten Elternteils erbt.
 */
async function withEffectiveColor<T extends ColorRow>(rows: T[]): Promise<(T & { effective_color: string | null })[]> {
  const all = unwrap(await db.from('projects').select('id,parent_id,color').is('deleted_at', null)) as ColorRow[];
  const byId = new Map(all.map((p) => [p.id, p]));
  for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
  const colors = projectColorMap([...byId.values()]);
  return rows.map((r) => ({ ...r, effective_color: colors.get(r.id) ?? null }));
}

export function registerProjectTools(server: McpServer) {
  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'List all projects and sub-projects (hierarchical via parent_id). Archived projects are hidden unless include_archived; soft-deleted projects are hidden unless include_deleted.',
      inputSchema: { include_archived: z.boolean().optional(), include_deleted: z.boolean().optional() },
    },
    async ({ include_archived, include_deleted }) =>
      guard(async () => {
        let q = db.from('projects').select(COLS).order('sort_order');
        if (!include_deleted) q = q.is('deleted_at', null);
        if (!include_archived) q = q.neq('status', 'archived');
        return ok(await withEffectiveColor(unwrap(await q) as ColorRow[]));
      }),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description: 'Get one project by id or slug (also finds archived / soft-deleted ones).',
      inputSchema: { id: z.string().optional(), slug: z.string().optional() },
    },
    async ({ id, slug }) =>
      guard(async () => {
        if (!id && !slug) throw new Error('Provide id or slug.');
        const q = db.from('projects').select(COLS);
        const res = id ? await q.eq('id', id).single() : await q.eq('slug', slug!).single();
        const [row] = await withEffectiveColor([unwrap(res) as ColorRow]);
        return ok(row);
      }),
  );

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Create a project (or sub-project via parent_id). Slug auto-generated if omitted. ' +
        'Farben: Unterprojekte ohne color anlegen, sie erben die Farbe des Elternprojekts. ' +
        'Ein neues Top-Level-Projekt bekommt eine Farbe aus der Palette, die noch kein anderes ' +
        `Top-Level-Projekt nutzt (vorher list_projects prüfen). Palette: ${PALETTE_HEXES}.`,
      inputSchema: {
        name: z.string(),
        slug: z.string().optional(),
        parent_id: z.string().optional(),
        description_md: z.string().optional(),
        color: z.string().optional(),
        status: z.enum(['active', 'paused', 'done', 'archived']).optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const slug = args.slug ?? `${slugify(args.name)}-${Date.now().toString(36).slice(-4)}`;
        return ok(unwrap(await db.from('projects').insert({ ...args, slug }).select(COLS).single()));
      }),
  );

  server.registerTool(
    'update_project',
    {
      title: 'Update project',
      description:
        'Update fields of a project. color: null entfernt die eigene Farbe, das Projekt erbt dann die des Elternprojekts.',
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        description_md: z.string().optional(),
        parent_id: z.string().nullable().optional(),
        color: z.string().nullable().optional().describe('Hex aus der Palette; null = erbt vom Elternprojekt'),
        status: z.enum(['active', 'paused', 'done', 'archived']).optional(),
        sort_order: z.number().optional(),
      },
    },
    async ({ id, ...patch }) =>
      guard(async () => ok(unwrap(await db.from('projects').update(patch).eq('id', id).select(COLS).single()))),
  );

  server.registerTool(
    'archive_project',
    {
      title: 'Archive project',
      description: 'Set a project status to archived: hidden from the main grid, still visible in the app archive.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('projects').update({ status: 'archived' }).eq('id', id));
        return ok({ archived: id });
      }),
  );

  server.registerTool(
    'unarchive_project',
    {
      title: 'Unarchive project',
      description: 'Bring a project back from the archive (status active).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('projects').update({ status: 'active' }).eq('id', id));
        return ok({ unarchived: id });
      }),
  );

  server.registerTool(
    'delete_project',
    {
      title: 'Delete project',
      description:
        'Soft-delete a project: disappears from the app but stays in the database (recoverable via restore_project). Its todos/notes/items are left untouched (no cascade).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', id));
        return ok({ deleted: id });
      }),
  );

  server.registerTool(
    'restore_project',
    {
      title: 'Restore project',
      description: 'Undo a soft-delete: bring a deleted project back into the app.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('projects').update({ deleted_at: null }).eq('id', id));
        return ok({ restored: id });
      }),
  );
}
