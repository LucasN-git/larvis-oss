import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Wrap data as a text tool result (JSON, pretty-printed). */
export function ok(data: unknown): CallToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Wrap an error as a tool result flagged isError. */
export function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/** Run a handler, converting thrown/Supabase errors into a fail() result. */
export async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** Throw if a Supabase response carries an error. */
export function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/**
 * PostgREST-Filter „liegt in Bereich x" für `.or(...)`: Hauptbereich oder weiterer Bereich.
 * Der Wert steht in Anführungszeichen, weil frei vergebene Bereiche Leerzeichen, Kommas
 * oder Klammern enthalten dürfen.
 */
export function areaFilter(area: string): string {
  const quoted = `"${area.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `area.eq.${quoted},also_areas.cs.{${quoted}}`;
}
