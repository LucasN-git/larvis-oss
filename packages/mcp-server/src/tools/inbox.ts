import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InboxItem, Upload } from '@larvis/shared';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';

const COLS = 'id,content,note,processed,scanned_at,scan_note,upload_id,created_at,processed_at,deleted_at';
// Lesepfad mit Datei-Embed; der Schreibpfad bleibt skalar.
const COLS_READ = `${COLS},upload:uploads(id,filename,mime_type,size_bytes,storage_path,created_at)`;
const UPLOADS_BUCKET = 'uploads';
// Gleiche Obergrenze wie der Kurzbefehl-Endpunkt (apps/web/api/shortcuts/inbox.ts).
const MAX_NOTE = 4_000;
// 6 h: ein Batch-Scan über viele Items läuft länger als eine Stunde.
const SIGNED_URL_TTL = 21600;

type InboxRow = InboxItem & { upload: Upload | null };

// Eine gebündelte Signierung für alle Datei-Items der Liste (die Liste ist unbegrenzt).
async function withSignedUrls(rows: InboxRow[]) {
  const paths = rows.flatMap((r) => (r.upload ? [r.upload.storage_path] : []));
  if (paths.length === 0) return rows;
  // Ein gescheiterter Signier-Aufruf ist ein Fehlerergebnis, keine Liste aus null-URLs.
  const signed = unwrap(await db.storage.from(UPLOADS_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL));
  const byPath = new Map<string, string>();
  for (const s of signed ?? []) if (s.path && s.signedUrl) byPath.set(s.path, s.signedUrl);
  return rows.map((r) =>
    r.upload ? { ...r, upload: { ...r.upload, signed_url: byPath.get(r.upload.storage_path) ?? null } } : r,
  );
}

export function registerInboxTools(server: McpServer) {
  server.registerTool(
    'list_inbox',
    {
      title: 'List inbox',
      description:
        'Quick-capture "dump" items the user threw in for you to sort. Three shapes: a URL in content; a file (upload with filename, mime_type, size_bytes and a signed_url valid ~6h — if an item has both, the file is the source and the URL becomes the entry url); or a plain text note. ' +
        "note is the user's own comment at capture time (why they saved it, what matters about it), null if none: it decides the area and goes verbatim into the entry's comment. " +
        'Unprocessed by default. unscanned_only:true returns only items you have not looked at yet (scanned_at null) — use it for a scan run. ' +
        'scanned ≠ processed: scanned = seen, stays visible (mark_inbox_scanned); processed = done, disappears (resolve_inbox_item). Soft-deleted items are hidden unless include_deleted.',
      inputSchema: {
        include_processed: z.boolean().optional(),
        include_deleted: z.boolean().optional(),
        unscanned_only: z.boolean().optional(),
      },
    },
    async ({ include_processed, include_deleted, unscanned_only }) =>
      guard(async () => {
        let q = db.from('inbox').select(COLS_READ).order('created_at', { ascending: false });
        if (!include_deleted) q = q.is('deleted_at', null);
        if (!include_processed) q = q.eq('processed', false);
        if (unscanned_only) q = q.is('scanned_at', null);
        const rows = unwrap(await q) as unknown as InboxRow[];
        return ok(await withSignedUrls(rows));
      }),
  );

  server.registerTool(
    'add_inbox_item',
    {
      title: 'Add inbox item',
      description:
        "Add a quick capture to the dump (text or URL; files are uploaded in the web app). note: the user's own comment on why they save it (optional, at most 4000 characters).",
      inputSchema: { content: z.string(), note: z.string().max(MAX_NOTE).optional() },
    },
    async ({ content, note }) =>
      guard(async () => {
        const trimmed = note?.trim();
        return ok(unwrap(await db.from('inbox').insert({ content, note: trimmed || null }).select(COLS).single()));
      }),
  );

  server.registerTool(
    'mark_inbox_scanned',
    {
      title: 'Mark inbox item scanned',
      description:
        'Record that you looked at a dump item WITHOUT resolving it: it stays visible in the dump but the next scan run skips it. ' +
        'Use after a failed acquisition (private, deleted, login required, unsupported format) or for a plain text note you did not analyze. ' +
        'note: one German line on what happened ("privat, nicht abrufbar", "Textnotiz — nicht analysiert"). ' +
        'scanned:false puts the item back into the scan queue (clears scanned_at and scan_note). Never use resolve_inbox_item for this — that marks the item done.',
      inputSchema: { id: z.string(), note: z.string().optional(), scanned: z.boolean().optional() },
    },
    async ({ id, note, scanned = true }) =>
      guard(async () => {
        const patch = scanned
          ? { scanned_at: new Date().toISOString(), ...(note !== undefined ? { scan_note: note } : {}) }
          : { scanned_at: null, scan_note: null };
        unwrap(await db.from('inbox').update(patch).eq('id', id));
        return ok({ id, scanned });
      }),
  );

  server.registerTool(
    'resolve_inbox_item',
    {
      title: 'Resolve inbox item',
      description:
        'Mark a dump item processed (done, disappears from the dump) once you have turned it into entries/todo/note. Also counts as scanned. ' +
        'note: one German line on what it became ("Eintrag kochen/Brot, auch reisen" or "2 Einträge: kochen #nachmachen (Rezept), reisen/Märkte (Ort)"). processed:false un-resolves but keeps scanned_at.',
      inputSchema: { id: z.string(), processed: z.boolean().optional(), note: z.string().optional() },
    },
    async ({ id, processed = true, note }) =>
      guard(async () => {
        const now = new Date().toISOString();
        // Auflösen durch Claude zählt als gescannt. Ein Un-Resolve lässt scanned_at
        // stehen — zurück in die Scan-Warteschlange nur explizit über mark_inbox_scanned.
        const patch = processed
          ? { processed: true, processed_at: now, scanned_at: now, ...(note !== undefined ? { scan_note: note } : {}) }
          : { processed: false, processed_at: null };
        unwrap(await db.from('inbox').update(patch).eq('id', id));
        return ok({ id, processed });
      }),
  );

  server.registerTool(
    'delete_inbox_item',
    {
      title: 'Delete inbox item',
      description: 'Soft-delete a dump item: disappears from the app but stays in the database (recoverable via restore_inbox_item).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('inbox').update({ deleted_at: new Date().toISOString() }).eq('id', id));
        return ok({ deleted: id });
      }),
  );

  server.registerTool(
    'restore_inbox_item',
    {
      title: 'Restore inbox item',
      description: 'Undo a soft-delete: bring a deleted dump item back into the app.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('inbox').update({ deleted_at: null }).eq('id', id));
        return ok({ restored: id });
      }),
  );
}
