import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';

const COLS = 'id,date,content_md,model,created_at';

/** Heutiges Datum als YYYY-MM-DD in Europe/Berlin (sv-SE formatiert ISO-Datum). */
function berlinToday(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}

export function registerBriefingTools(server: McpServer) {
  server.registerTool(
    'save_briefing',
    {
      title: 'Save daily briefing',
      description:
        'Store the daily briefing as compact German markdown. One briefing per day (upsert on date); ' +
        'the "Heute" page renders the latest one. date is YYYY-MM-DD (Europe/Berlin), defaults to today. ' +
        'Structure: ## 📅 Termine / ## 🎯 Top 3 / ## ✅ Offen (N) / ## 📥 Inbox (N) / ## 💡 Fokus — ' +
        'one fact per line, no prose, no preamble.',
      inputSchema: {
        content_md: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      },
    },
    async ({ content_md, date }) =>
      guard(async () =>
        ok(
          unwrap(
            await db
              .from('briefings')
              .upsert({ date: date ?? berlinToday(), content_md }, { onConflict: 'date' })
              .select(COLS)
              .single(),
          ),
        ),
      ),
  );

  server.registerTool(
    'get_briefing',
    {
      title: 'Get daily briefing',
      description: 'Read the briefing for a date (YYYY-MM-DD, defaults to today Europe/Berlin), or null if none exists yet.',
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
    },
    async ({ date }) =>
      guard(async () =>
        ok(unwrap(await db.from('briefings').select(COLS).eq('date', date ?? berlinToday()).maybeSingle())),
      ),
  );
}
