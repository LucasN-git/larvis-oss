import type { ApiRequest, ApiResponse } from '../_lib/types.js';
import type { Todo } from '@larvis/shared';
import { todoToEventInput } from '../_lib/calendar.js';
import { admin } from '../_lib/supabaseAdmin.js';
import { verifyOwner } from '../_lib/webAuth.js';
import {
  createEvent,
  deleteEvent,
  ensureAccessToken,
  ensureLarvisCalendar,
  findEventByTodo,
  getAccount,
  projectColor,
  updateEvent,
} from '../_lib/google.js';

type TodoLike = Pick<Todo, 'id' | 'title' | 'due_at' | 'status' | 'project_id' | 'tags' | 'gcal_event_id'>;

// Reconcile a single todo with its mirrored event on the Larvis calendar.
// Called fire-and-forget from the web app after a todo mutation. The MCP server
// does the same server-side via syncTodoEvent() in its own google.ts.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  if (!(await verifyOwner(req))) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  try {
    const sb = admin();
    const acct = await getAccount(sb);
    if (!acct?.refresh_token) {
      res.status(200).json({ synced: false, reason: 'not_connected' });
      return;
    }
    const token = await ensureAccessToken(sb, acct);
    const calId = await ensureLarvisCalendar(sb, acct, token);
    const body = (req.body ?? {}) as { todo?: TodoLike; delete_event_id?: string };

    // A deleted todo: just remove its event (the row is already gone).
    if (body.delete_event_id) {
      await deleteEvent(token, calId, body.delete_event_id).catch(() => {});
      res.status(200).json({ synced: true, deleted: body.delete_event_id });
      return;
    }

    const todo = body.todo;
    if (!todo?.id) {
      res.status(400).json({ error: 'todo or delete_event_id required.' });
      return;
    }

    const input = todoToEventInput(todo);

    // No (longer a) due date -> drop any existing mirror.
    if (!input) {
      const stale = todo.gcal_event_id ?? (await findEventByTodo(token, calId, todo.id));
      if (stale) {
        await deleteEvent(token, calId, stale).catch(() => {});
        await sb.from('todos').update({ gcal_event_id: null }).eq('id', todo.id);
      }
      res.status(200).json({ synced: true, event_id: null });
      return;
    }

    const color = await projectColor(sb, todo.project_id);

    let eventId = todo.gcal_event_id ?? null;
    if (eventId) {
      try {
        await updateEvent(token, calId, eventId, input, color);
        res.status(200).json({ synced: true, event_id: eventId });
        return;
      } catch {
        eventId = null; // vanished in Google -> fall through
      }
    }

    // Idempotency: reuse an event already tagged with this todo id before creating.
    eventId = await findEventByTodo(token, calId, todo.id);
    if (eventId) {
      await updateEvent(token, calId, eventId, input, color);
      if (eventId !== todo.gcal_event_id) await sb.from('todos').update({ gcal_event_id: eventId }).eq('id', todo.id);
      res.status(200).json({ synced: true, event_id: eventId });
      return;
    }

    const ev = await createEvent(token, calId, input, color);
    await sb.from('todos').update({ gcal_event_id: ev.id }).eq('id', todo.id);
    res.status(200).json({ synced: true, event_id: ev.id });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
