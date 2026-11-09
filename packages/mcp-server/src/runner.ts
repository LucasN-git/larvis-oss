#!/usr/bin/env node
// Larvis local agent runner (opt-in, foundation stub).
//
// Polls the agent_tasks queue, claims the oldest `queued` task, and runs its
// prompt headless via the Claude Code CLI (`claude -p`). Because the Larvis MCP
// server is configured in your Claude, the spawned agent can use Larvis tools
// to actually take work off your plate. Results are written back to the task.
//
// This EXECUTES AI-generated actions automatically — start it only intentionally:
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run runner -w @larvis/mcp-server
//
// Wire up of model/permission policy is intentionally minimal for the foundation.
import { spawn } from 'node:child_process';
import { db } from './supabase.js';

const INTERVAL = Number(process.env.LARVIS_RUNNER_INTERVAL ?? 5000);
const CLAUDE_BIN = process.env.LARVIS_CLAUDE_BIN ?? 'claude';

const COLS = 'id,project_id,title,prompt_md,status,model';

async function claimNext() {
  const { data: next, error } = await db
    .from('agent_tasks')
    .select('id')
    .eq('status', 'queued')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!next) return null;

  const { data: claimed, error: e2 } = await db
    .from('agent_tasks')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', next.id)
    .eq('status', 'queued') // lose the race -> someone else took it
    .select(COLS)
    .maybeSingle();
  if (e2) throw new Error(e2.message);
  return claimed;
}

function runClaude(prompt: string, model: string | null): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const args = ['-p', prompt, ...(model ? ['--model', model] : [])];
    const child = spawn(CLAUDE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ ok: false, output: `spawn failed: ${e.message}` }));
    child.on('close', (code) => resolve({ ok: code === 0, output: code === 0 ? out : err || out }));
  });
}

async function tick() {
  const task = await claimNext();
  if (!task) return;
  console.error(`[runner] running task ${task.id} — ${task.title || task.prompt_md.slice(0, 50)}`);
  const { ok, output } = await runClaude(task.prompt_md, task.model);
  await db
    .from('agent_tasks')
    .update({
      status: ok ? 'done' : 'failed',
      result_md: ok ? output : null,
      error: ok ? null : output.slice(0, 4000),
      finished_at: new Date().toISOString(),
    })
    .eq('id', task.id);
  console.error(`[runner] task ${task.id} ${ok ? 'done' : 'failed'}`);
}

async function main() {
  console.error(`[runner] polling agent_tasks every ${INTERVAL}ms (claude bin: ${CLAUDE_BIN})`);
  // Simple sequential poll loop; one task at a time keeps it predictable.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      console.error('[runner] error:', e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main();
