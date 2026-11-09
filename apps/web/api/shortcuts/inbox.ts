import type { ApiRequest, ApiResponse } from '../_lib/types.js';
import { admin } from '../_lib/supabaseAdmin.js';

// Capture endpoint for the iOS Share-Sheet shortcut: drops shared text/links
// straight into the Larvis inbox. Static bearer token instead of the MCP's
// OAuth flow — Shortcuts can't run an OAuth dance, but it can send a header.
//
// Body: { content: string, note?: string }. content is the shared link or text
// (required); note is the user's own comment on why they save it (optional, empty →
// null). The old body without note keeps working.
const MAX_CONTENT = 20_000;
const MAX_NOTE = 4_000;

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const expected = process.env.SHORTCUT_INBOX_TOKEN;
  const auth = req.headers['authorization'];
  const token = Array.isArray(auth) ? auth[0] : auth;
  if (!expected || token !== `Bearer ${expected}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = (req.body ?? {}) as { content?: unknown; note?: unknown };
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  if (content.length > MAX_CONTENT) {
    res.status(413).json({ error: `content is longer than ${MAX_CONTENT} characters` });
    return;
  }
  const noteText = typeof body.note === 'string' ? body.note.trim() : '';
  if (noteText.length > MAX_NOTE) {
    res.status(413).json({ error: `note is longer than ${MAX_NOTE} characters` });
    return;
  }
  // note nur mitschicken, wenn es einen gibt: ein Body ohne Kommentar funktioniert so auch
  // gegen eine Datenbank, der die Spalte inbox.note noch fehlt.
  const row: { content: string; note?: string } = noteText ? { content, note: noteText } : { content };

  const { data, error } = await admin().from('inbox').insert(row).select('id').single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ ok: true, id: data.id });
}
