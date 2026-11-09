import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';

const COLS =
  'id,project_id,title,prompt_md,status,result_md,error,model,created_by,created_at,started_at,finished_at';

export function registerAgentTools(server: McpServer) {
  server.registerTool(
    'create_agent_task',
    {
      title: 'Queue agent task',
      description: 'Enqueue a prompt for the local agent runner to execute.',
      inputSchema: {
        prompt_md: z.string(),
        title: z.string().optional(),
        project_id: z.string().nullable().optional(),
        model: z.string().optional(),
      },
    },
    async (args) =>
      guard(async () =>
        ok(unwrap(await db.from('agent_tasks').insert({ created_by: 'claude', ...args }).select(COLS).single())),
      ),
  );

  server.registerTool(
    'list_agent_tasks',
    {
      title: 'List agent tasks',
      description: 'List queued/running/finished agent tasks.',
      inputSchema: {
        project_id: z.string().optional(),
        status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']).optional(),
      },
    },
    async ({ project_id, status }) =>
      guard(async () => {
        let q = db.from('agent_tasks').select(COLS).order('created_at', { ascending: false });
        if (project_id) q = q.eq('project_id', project_id);
        if (status) q = q.eq('status', status);
        return ok(unwrap(await q));
      }),
  );

  server.registerTool(
    'claim_next_agent_task',
    {
      title: 'Claim next agent task',
      description: 'For the runner: take the oldest queued task, mark it running, and return it.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const next = unwrap(
          await db.from('agent_tasks').select('id').eq('status', 'queued').order('created_at').limit(1).maybeSingle(),
        );
        if (!next) return ok({ task: null });
        const claimed = unwrap(
          await db
            .from('agent_tasks')
            .update({ status: 'running', started_at: new Date().toISOString() })
            .eq('id', next.id)
            .eq('status', 'queued')
            .select(COLS)
            .single(),
        );
        return ok({ task: claimed });
      }),
  );

  server.registerTool(
    'update_agent_task',
    {
      title: 'Update agent task',
      description: 'For the runner: write back status, result_md or error. Sets finished_at on terminal states.',
      inputSchema: {
        id: z.string(),
        status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']).optional(),
        result_md: z.string().optional(),
        error: z.string().optional(),
      },
    },
    async ({ id, status, result_md, error }) =>
      guard(async () => {
        const patch: {
          status?: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
          result_md?: string;
          error?: string;
          finished_at?: string;
        } = {};
        if (status) patch.status = status;
        if (result_md !== undefined) patch.result_md = result_md;
        if (error !== undefined) patch.error = error;
        if (status && ['done', 'failed', 'cancelled'].includes(status)) patch.finished_at = new Date().toISOString();
        return ok(unwrap(await db.from('agent_tasks').update(patch).eq('id', id).select(COLS).single()));
      }),
  );
}
