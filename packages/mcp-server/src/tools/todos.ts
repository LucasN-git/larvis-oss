import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Todo } from '@larvis/shared';
import { db } from '../supabase.js';
import { deleteTodoEvent, syncTodoEvent } from '../google.js';
import { guard, ok, unwrap } from '../util.js';

const COLS =
  'id,project_id,area,title,body_md,status,priority,backlog,due_at,completed_at,tags,gcal_event_id,sort_order,created_at,updated_at,deleted_at';

type TodoRow = Pick<Todo, 'id' | 'title' | 'due_at' | 'status' | 'project_id' | 'tags' | 'gcal_event_id'>;

export function registerTodoTools(server: McpServer) {
  server.registerTool(
    'list_todos',
    {
      title: 'List todos',
      description:
        'List todos, filterable by area, project, status. Hides done unless include_done. backlog: false excludes parked items, true returns only them. for_today: true returns todos due today or overdue (the Heute page). Soft-deleted todos are hidden unless include_deleted.',
      inputSchema: {
        area: z.enum(['project', 'personal']).optional(),
        project_id: z.string().nullable().optional(),
        status: z.enum(['todo', 'doing', 'done']).optional(),
        include_done: z.boolean().optional(),
        backlog: z.boolean().optional(),
        for_today: z.boolean().optional(),
        include_deleted: z.boolean().optional(),
      },
    },
    async ({ area, project_id, status, include_done, backlog, for_today, include_deleted }) =>
      guard(async () => {
        let q = db.from('todos').select(COLS);
        if (!include_deleted) q = q.is('deleted_at', null);
        if (area) q = q.eq('area', area);
        if (project_id !== undefined) q = project_id === null ? q.is('project_id', null) : q.eq('project_id', project_id);
        if (status) q = q.eq('status', status);
        else if (!include_done) q = q.neq('status', 'done');
        if (backlog !== undefined) q = q.eq('backlog', backlog);
        if (for_today) {
          const end = new Date();
          end.setHours(23, 59, 59, 999);
          q = q.lte('due_at', end.toISOString());
        }
        return ok(unwrap(await q.order('priority', { ascending: false }).order('due_at', { nullsFirst: false })));
      }),
  );

  server.registerTool(
    'create_todo',
    {
      title: 'Create todo',
      description:
        'Create a todo. due_at is ISO 8601 — a due date of today (or earlier) puts it on the Heute page. It is mirrored automatically into the Larvis calendar (UTC midnight = all-day, otherwise a 30-min slot). priority 0–3 (3=high).',
      inputSchema: {
        title: z.string(),
        body_md: z.string().optional(),
        area: z.enum(['project', 'personal']).optional(),
        project_id: z.string().nullable().optional(),
        priority: z.number().min(0).max(3).optional(),
        backlog: z.boolean().optional(),
        due_at: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const row = unwrap(await db.from('todos').insert(args).select(COLS).single());
        await syncTodoEvent(row as TodoRow);
        return ok(row);
      }),
  );

  server.registerTool(
    'update_todo',
    {
      title: 'Update todo',
      description: 'Update fields of a todo. Changes to due_at / title / status / project are mirrored to the calendar.',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        body_md: z.string().optional(),
        status: z.enum(['todo', 'doing', 'done']).optional(),
        priority: z.number().min(0).max(3).optional(),
        backlog: z.boolean().optional(),
        due_at: z.string().nullable().optional(),
        project_id: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ id, ...patch }) =>
      guard(async () => {
        const row = unwrap(await db.from('todos').update(patch).eq('id', id).select(COLS).single());
        await syncTodoEvent(row as TodoRow);
        return ok(row);
      }),
  );

  server.registerTool(
    'complete_todo',
    {
      title: 'Complete todo',
      description: 'Mark a todo done (or reopen with done=false). The calendar entry gets a ✓ prefix when done.',
      inputSchema: { id: z.string(), done: z.boolean().optional() },
    },
    async ({ id, done = true }) =>
      guard(async () => {
        const patch = { status: done ? 'done' : 'todo', completed_at: done ? new Date().toISOString() : null };
        const row = unwrap(await db.from('todos').update(patch).eq('id', id).select(COLS).single());
        await syncTodoEvent(row as TodoRow);
        return ok(row);
      }),
  );

  server.registerTool(
    'delete_todo',
    {
      title: 'Delete todo',
      description:
        'Soft-delete a todo: it disappears from the app but stays in the database (recoverable via restore_todo). The mirrored calendar entry is removed.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        const { data } = await db.from('todos').select('gcal_event_id').eq('id', id).maybeSingle();
        unwrap(await db.from('todos').update({ deleted_at: new Date().toISOString() }).eq('id', id));
        await deleteTodoEvent(data?.gcal_event_id ?? null);
        return ok({ deleted: id });
      }),
  );

  server.registerTool(
    'restore_todo',
    {
      title: 'Restore todo',
      description: 'Undo a soft-delete: bring a deleted todo back into the app. Re-mirrors its calendar entry if dated.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        const row = unwrap(await db.from('todos').update({ deleted_at: null }).eq('id', id).select(COLS).single());
        await syncTodoEvent(row as TodoRow);
        return ok({ restored: id });
      }),
  );
}
