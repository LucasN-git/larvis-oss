// Type surface for the generated bundle (api/_lib/mcp-bundle.js), produced at
// build time by scripts/build-mcp-bundle.mjs from @larvis/mcp-server. The .js is
// git-ignored and only exists after a build; this declaration lets `tsc` resolve
// the import either way. Keep in sync with createLarvisServer's real signature.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function createLarvisServer(): McpServer;
