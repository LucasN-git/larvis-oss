#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLarvisServer } from './server.js';

const server = createLarvisServer();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[larvis-mcp] running on stdio');
}

main().catch((err) => {
  console.error('[larvis-mcp] fatal:', err);
  process.exit(1);
});
