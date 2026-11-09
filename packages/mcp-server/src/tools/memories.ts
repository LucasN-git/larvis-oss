import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MEMORY_KINDS } from '@larvis/shared';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';

const COLS = 'id,slug,title,content_md,kind,scope,created_at,updated_at';

export function registerMemoryTools(server: McpServer) {
  server.registerTool(
    'list_memories',
    {
      title: 'List memories',
      description:
        'List persistent agent memories (facts, preferences, working agreements about the user), optionally filtered by kind or scope. ' +
        'Note: memories can be synced into a CLAUDE.md (npm run memory:sync) — if that is set up, only call this when you need fresher data than the session context.',
      inputSchema: {
        kind: z.enum(MEMORY_KINDS).optional(),
        scope: z.string().optional(),
      },
    },
    async ({ kind, scope }) =>
      guard(async () => {
        let q = db.from('memories').select(COLS).order('kind').order('updated_at', { ascending: false });
        if (kind) q = q.eq('kind', kind);
        if (scope) q = q.eq('scope', scope);
        return ok(unwrap(await q));
      }),
  );

  server.registerTool(
    'save_memory',
    {
      title: 'Save memory',
      description:
        'Create or update a persistent memory (upsert on slug). Use this when the user states a durable fact, preference, correction, ' +
        'or way-of-working that future agent sessions should know — one fact per memory, short German markdown. ' +
        "kind: 'user' facts about the user, 'feedback' how agents should work, 'project' ongoing work/goals, " +
        "'reference' links/pointers, 'skill' notes on skills/automations. scope: null for global, else a project slug. " +
        'Memories may be synced into a CLAUDE.md, so keep content_md compact — there it costs context in every session.',
      inputSchema: {
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case'),
        title: z.string(),
        content_md: z.string(),
        kind: z.enum(MEMORY_KINDS).optional(),
        scope: z.string().nullable().optional(),
      },
    },
    async (args) =>
      guard(async () =>
        ok(unwrap(await db.from('memories').upsert(args, { onConflict: 'slug' }).select(COLS).single())),
      ),
  );

  server.registerTool(
    'delete_memory',
    {
      title: 'Delete memory',
      description: 'Permanently delete a memory by slug (for facts that turned out wrong or obsolete).',
      inputSchema: { slug: z.string() },
    },
    async ({ slug }) =>
      guard(async () => {
        unwrap(await db.from('memories').delete().eq('slug', slug));
        return ok({ deleted: slug });
      }),
  );
}
