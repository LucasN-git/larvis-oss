import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LARVIS_OVERVIEW_MD } from '@larvis/shared';
import { ok } from '../util.js';

export function registerOverviewTools(server: McpServer) {
  server.registerTool(
    'get_larvis_overview',
    {
      title: 'Explain Larvis',
      description:
        'Explain how Larvis works: what each area is for (Dump, Inbox-Tab/entries, Notizen, Learnings wiki, Dinge, Projekte/ToDos, Memories, Kontakte, Kalender, Learnweb, Agent-Queue), which tools belong to which area, and the rules for choosing between a note, a learning, an entry and a memory. Call this first when unsure where something belongs or what a tab in the app means.',
      inputSchema: {},
    },
    async () => ok(LARVIS_OVERVIEW_MD),
  );
}
