import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LARVIS_INSTRUCTIONS } from '@larvis/shared';
import { registerProjectTools } from './tools/projects.js';
import { registerTodoTools } from './tools/todos.js';
import { registerNoteTools } from './tools/notes.js';
import { registerItemTools } from './tools/items.js';
import { registerAgentTools } from './tools/agents.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerContactTools } from './tools/contacts.js';
import { registerPlaceTools } from './tools/places.js';
import { registerInboxTools } from './tools/inbox.js';
import { registerBriefingTools } from './tools/briefings.js';
import { registerSearchTools } from './tools/search.js';
import { registerMensaTools } from './tools/mensa.js';
import { registerWeatherTools } from './tools/weather.js';
import { registerEntryTools } from './tools/entries.js';
import { registerLearnwebTools } from './tools/learnweb.js';
import { registerMemoryTools } from './tools/memories.js';
import { registerLearningTools } from './tools/learnings.js';
import { registerOverviewTools } from './tools/overview.js';
import { readConfig, type LarvisConfig } from './config.js';

/**
 * Build a fully-configured Larvis MCP server with all tool suites registered.
 *
 * Transport-agnostic on purpose: the stdio entry point ([index.ts]) and the
 * remote HTTP endpoint (apps/web/api/mcp.ts) both call this and then attach
 * their own transport. In stateless HTTP mode a fresh instance is created per
 * request, so this must stay cheap and side-effect-free beyond registration.
 */
export function createLarvisServer(config: LarvisConfig = readConfig()): McpServer {
  // Die instructions sieht jeder Client beim Verbinden: die Kurzfassung, wofür die Bereiche
  // da sind. Die Langfassung liefert get_larvis_overview.
  const server = new McpServer({ name: 'larvis', version: '0.1.0' }, { instructions: LARVIS_INSTRUCTIONS });

  registerProjectTools(server);
  registerTodoTools(server);
  registerNoteTools(server);
  registerItemTools(server);
  registerAgentTools(server);
  registerCalendarTools(server);
  registerContactTools(server);
  registerPlaceTools(server, config);
  registerInboxTools(server);
  registerBriefingTools(server);
  registerSearchTools(server);
  // Optionale Module: ihre Tools gibt es nur, wenn sie konfiguriert sind (siehe config.ts).
  if (config.canteens.length > 0) registerMensaTools(server, config.canteens);
  registerWeatherTools(server, config.weather);
  registerEntryTools(server);
  if (config.learnweb) registerLearnwebTools(server);
  registerMemoryTools(server);
  registerLearningTools(server);
  registerOverviewTools(server);

  return server;
}
