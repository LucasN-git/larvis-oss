import type { IncomingMessage, ServerResponse } from 'node:http';
import { protectedResourceMetadata } from './_lib/mcpAuth.js';

// RFC 9728 Protected Resource Metadata. Served at the domain root
// (/.well-known/oauth-protected-resource) by server/index.mjs, so
// claude.ai can discover the authorization server from the WWW-Authenticate
// challenge that api/mcp.ts returns on 401.
export default function handler(req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(JSON.stringify(protectedResourceMetadata(req)));
}
