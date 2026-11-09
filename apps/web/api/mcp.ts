import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createLarvisServer } from './_lib/mcp-bundle.js';
import { sendUnauthorized, verifyBearer } from './_lib/mcpAuth.js';

// Remote MCP endpoint for claude.ai custom connectors (Node runtime: the MCP SDK
// transport + supabase-js need Node APIs).
// Resource server in the OAuth flow: Supabase Auth issues the tokens, this only
// validates them and runs the tools. Stateless Streamable HTTP — a fresh server
// + transport per request, so no state survives between requests.
type Req = IncomingMessage & { body?: unknown };

export default async function handler(req: Req, res: ServerResponse) {
  const claims = await verifyBearer(req);
  if (!claims) {
    sendUnauthorized(req, res);
    return;
  }

  const server = createLarvisServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    // server/index.mjs has already parsed the JSON body; pass it so the transport doesn't
    // try to re-read the consumed request stream.
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: e instanceof Error ? e.message : 'Internal error' },
          id: null,
        }),
      );
    }
  }
}
