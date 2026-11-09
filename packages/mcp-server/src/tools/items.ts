import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';

const COLS = 'id,name,location,category,notes_md,area,project_id,tags,created_at,updated_at,deleted_at';

export function registerItemTools(server: McpServer) {
  server.registerTool(
    'list_items',
    {
      title: 'List items',
      description: 'List tracked items ("where is X"), optionally by area. Soft-deleted items are hidden unless include_deleted.',
      inputSchema: { area: z.enum(['project', 'personal']).optional(), include_deleted: z.boolean().optional() },
    },
    async ({ area, include_deleted }) =>
      guard(async () => {
        let q = db.from('items').select(COLS).order('name');
        if (!include_deleted) q = q.is('deleted_at', null);
        if (area) q = q.eq('area', area);
        return ok(unwrap(await q));
      }),
  );

  server.registerTool(
    'find_item',
    {
      title: 'Find item',
      description: 'Full-text search for an item by name, location or notes ("wo liegt mein Reisepass?"). Excludes soft-deleted items.',
      inputSchema: { query: z.string() },
    },
    async ({ query }) =>
      guard(async () =>
        ok(
          unwrap(
            await db
              .from('items')
              .select(COLS)
              .is('deleted_at', null)
              .textSearch('search', query, { type: 'websearch', config: 'simple' }),
          ),
        ),
      ),
  );

  server.registerTool(
    'upsert_item',
    {
      title: 'Upsert item',
      description: 'Create or update an item. Pass id to update, omit to create.',
      inputSchema: {
        id: z.string().optional(),
        name: z.string(),
        location: z.string().optional(),
        category: z.string().nullable().optional(),
        notes_md: z.string().optional(),
        area: z.enum(['project', 'personal']).optional(),
        project_id: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (args) => guard(async () => ok(unwrap(await db.from('items').upsert(args).select(COLS).single()))),
  );

  server.registerTool(
    'delete_item',
    {
      title: 'Delete item',
      description: 'Soft-delete an item: disappears from the app but stays in the database (recoverable via restore_item).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('items').update({ deleted_at: new Date().toISOString() }).eq('id', id));
        return ok({ deleted: id });
      }),
  );

  server.registerTool(
    'restore_item',
    {
      title: 'Restore item',
      description: 'Undo a soft-delete: bring a deleted item back into the app.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('items').update({ deleted_at: null }).eq('id', id));
        return ok({ restored: id });
      }),
  );
}
