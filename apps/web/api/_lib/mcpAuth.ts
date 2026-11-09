import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// --- URLs --------------------------------------------------------------------

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Origin of the deployment. Pinned to MCP_RESOURCE_URL when configured, so the
 * advertised discovery URLs can't be bent by a spoofed Host/x-forwarded-host
 * header; otherwise derived from the proxied request (mirrors google.ts).
 */
function origin(req: IncomingMessage): string {
  if (process.env.MCP_RESOURCE_URL) {
    try {
      return new URL(process.env.MCP_RESOURCE_URL).origin;
    } catch {
      /* fall through to request-derived origin */
    }
  }
  const proto = header(req, 'x-forwarded-proto') || 'https';
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  return `${proto}://${host}`;
}

/**
 * Canonical resource identifier for this MCP server (RFC 8707 audience).
 * In production set MCP_RESOURCE_URL to a stable value and bind the token `aud`
 * to the same string via the Supabase custom access token hook. Falls back to
 * the request origin so the endpoint also works on preview deployments.
 */
export function resourceUrl(req: IncomingMessage): string {
  return process.env.MCP_RESOURCE_URL || `${origin(req)}/api/mcp`;
}

/** Where the RFC 9728 protected-resource metadata is served (root well-known). */
export function resourceMetadataUrl(req: IncomingMessage): string {
  return `${origin(req)}/.well-known/oauth-protected-resource`;
}

/** Supabase Auth acts as the OAuth 2.1 authorization server for this resource. */
function authorizationServer(): string {
  const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/auth/v1`;
}

/** RFC 9728 Protected Resource Metadata document. */
export function protectedResourceMetadata(req: IncomingMessage) {
  return {
    resource: resourceUrl(req),
    authorization_servers: [authorizationServer()],
    bearer_methods_supported: ['header'],
    scopes_supported: [] as string[],
  };
}

// --- Token verification ------------------------------------------------------

let _sb: SupabaseClient | null = null;
function verifier(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // Anon key is public; only used so getClaims can reach the JWKS. No default:
  // a stale fallback would point token verification at the wrong instance.
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url) throw new Error('Missing SUPABASE_URL');
  if (!key) throw new Error('Missing VITE_SUPABASE_ANON_KEY');
  _sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _sb;
}

function audienceMatches(aud: unknown, resource: string): boolean {
  if (typeof aud === 'string') return aud === resource;
  if (Array.isArray(aud)) return aud.includes(resource);
  return false;
}

/**
 * Verify the Bearer token and return the caller, or null to reject.
 *
 * Security boundary, in order:
 *  1. getClaims verifies the JWT signature + expiry against the project JWKS, so
 *     only genuine, unexpired tokens from this Supabase project pass.
 *  2. The token must carry a `client_id` claim, i.e. it was issued through the
 *     OAuth 2.1 server to a registered client. Plain web-session JWTs have no
 *     client_id, so a leaked app session can't be replayed against this endpoint.
 *  3. Optional hardening via env: MCP_ALLOWED_CLIENT_ID pins the exact OAuth
 *     client; MCP_RESOURCE_URL enforces RFC 8707 audience binding (requires the
 *     custom access token hook to stamp `aud`).
 */
export async function verifyBearer(
  req: IncomingMessage,
): Promise<{ sub: string; clientId: string } | null> {
  const auth = header(req, 'authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
  if (!token) return null;

  const { data, error } = await verifier().auth.getClaims(token);
  if (error || !data?.claims) return null;

  const claims = data.claims as { sub?: string; aud?: unknown; client_id?: unknown };
  if (!claims.sub) return null;
  if (typeof claims.client_id !== 'string' || !claims.client_id) return null;

  const allowed = process.env.MCP_ALLOWED_CLIENT_ID;
  if (allowed && claims.client_id !== allowed) return null;

  if (process.env.MCP_RESOURCE_URL && !audienceMatches(claims.aud, process.env.MCP_RESOURCE_URL)) {
    return null;
  }

  return { sub: claims.sub, clientId: claims.client_id };
}

/** RFC 6750 / MCP 401 challenge that kicks off OAuth discovery on the client. */
export function sendUnauthorized(req: IncomingMessage, res: ServerResponse, errorDescription?: string) {
  const parts = [`Bearer realm="larvis"`, `resource_metadata="${resourceMetadataUrl(req)}"`];
  if (errorDescription) parts.push(`error="invalid_token"`, `error_description="${errorDescription}"`);
  res.setHeader('WWW-Authenticate', parts.join(', '));
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'unauthorized', error_description: errorDescription ?? 'Authentication required' }));
}
