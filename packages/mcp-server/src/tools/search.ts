import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';

export function registerSearchTools(server: McpServer) {
  server.registerTool(
    'search_everything',
    {
      title: 'Search everything',
      description:
        'Second-brain recall: search notes, items, todos, projects, contacts, saved entries (all areas; includes the comment the user wrote when saving) and the curated wiki (learnings) in one call.',
      inputSchema: { query: z.string() },
    },
    async ({ query }) =>
      guard(async () => {
        // Soft-deleted rows are excluded everywhere; the app never surfaces them.
        const [notes, items, todos, projects, entries, contacts, learnings] = await Promise.all([
          db.from('notes').select('id,title,body_md,area,project_id,icon,version_no').is('deleted_at', null).is('superseded_at', null).textSearch('search', query, { type: 'websearch', config: 'simple' }),
          db.from('items').select('id,name,location,area').is('deleted_at', null).textSearch('search', query, { type: 'websearch', config: 'simple' }),
          db.from('todos').select('id,title,status,project_id,due_at').is('deleted_at', null).ilike('title', `%${query}%`),
          db.from('projects').select('id,name,slug,status').is('deleted_at', null).ilike('name', `%${query}%`),
          db.from('entries').select('id,area,also_areas,name,category,url,comment').is('deleted_at', null).textSearch('search', query, { type: 'websearch', config: 'simple' }),
          db.from('contacts').select('id,first_name,last_name,company,current_status').is('deleted_at', null).or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,company.ilike.%${query}%`),
          db.from('learnings').select('id,slug,area,title,summary').is('deleted_at', null).textSearch('search', query, { type: 'websearch', config: 'simple' }),
        ]);
        return ok({
          notes: unwrap(notes),
          items: unwrap(items),
          todos: unwrap(todos),
          projects: unwrap(projects),
          entries: unwrap(entries),
          contacts: unwrap(contacts),
          learnings: unwrap(learnings),
        });
      }),
  );
}
