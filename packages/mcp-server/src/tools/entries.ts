import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AREA_MAX_LENGTH, SOURCE_MEDIA_TYPES, SOURCE_PLATFORMS, normalizeArea, normalizeAreas } from '@larvis/shared';
import { db } from '../supabase.js';
import { areaFilter, fail, guard, ok, unwrap } from '../util.js';

const COLS =
  'id,area,also_areas,name,url,description,category,tags,comment,notes_md,' +
  'source_platform,source_media_type,source_author,source_author_handle,source_title,' +
  'source_published_at,source_duration_seconds,source_word_count,source_page_count,' +
  'upload_id,captured_at,created_at,updated_at,deleted_at';
// Lesepfad mit Datei-Embed; der Schreibpfad bleibt skalar.
const COLS_READ = `${COLS},upload:uploads(id,filename,mime_type,size_bytes,storage_path,created_at)`;
// Schmaler Lesepfad (brief:true) für einen Such-Skill, der viele Treffer überfliegt:
// ohne notes_md und Datei-Embed, damit die Antwort klein bleibt.
const COLS_BRIEF =
  'id,area,also_areas,name,url,category,tags,description,comment,' +
  'source_platform,source_author_handle,source_title,upload_id,created_at';

// The area rules below are the contract a filing skill relies on: areas are free text, so
// consistency comes from reusing the names list_areas returns.
const AREA_RULES = [
  `area is a short free-text topic the user files by (lowercase, e.g. 'kochen' or 'reisen'); it is stored normalized (trimmed, lowercase, single spaces, max ${AREA_MAX_LENGTH} chars).`,
  'Call list_areas first and reuse an existing area whenever one fits — the spelling must match exactly; introduce a new area only when nothing fits.',
  'File an entry where the user would search for it later — by topic, not by form. If the user left a dump note, it decides the area.',
  'One find that serves two topics gets a main area (area) and the second in also_areas — never file it twice. Two different finds from one source are two entries with the same url.',
  "Form is a tag, not an area: add 'nachmachen' for something to recreate and 'idee' for an idea, alongside the topic tags.",
].join(' ');

const areaField = z
  .string()
  .min(1)
  .describe('Free-text area (topic). Reuse a name from list_areas; stored lowercase and trimmed.');

const ENTRY_FIELDS = {
  id: z.string().optional(),
  area: areaField,
  also_areas: z.array(z.string()).optional(),
  name: z.string(),
  url: z.string().nullable().optional(),
  description: z.string().optional(),
  category: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  comment: z.string().optional(),
  notes_md: z.string().optional(),
  source_platform: z.enum(SOURCE_PLATFORMS).nullable().optional(),
  source_media_type: z.enum(SOURCE_MEDIA_TYPES).nullable().optional(),
  source_author: z.string().nullable().optional(),
  source_author_handle: z.string().nullable().optional(),
  source_title: z.string().nullable().optional(),
  source_published_at: z.string().nullable().optional(),
  source_duration_seconds: z.number().int().nullable().optional(),
  source_word_count: z.number().int().nullable().optional(),
  source_page_count: z.number().int().nullable().optional(),
  upload_id: z.string().nullable().optional(),
  captured_at: z.string().optional(),
};

type EntryArgs = z.infer<z.ZodObject<typeof ENTRY_FIELDS>>;

async function upsertEntry(args: EntryArgs) {
  const area = normalizeArea(args.area);
  if (!area) return fail('area must not be empty — pick one from list_areas or name a new one.');
  // Der Hauptbereich steht nie in also_areas (DB-Check); doppelte Werte fallen weg. Ohne
  // also_areas im Aufruf wird beim Update die gespeicherte Liste bereinigt, falls der neue
  // Hauptbereich bisher ein weiterer Bereich war.
  let also = args.also_areas;
  if (!also && args.id) {
    const cur = unwrap(await db.from('entries').select('also_areas').eq('id', args.id).maybeSingle());
    if (cur?.also_areas?.includes(area)) also = cur.also_areas;
  }
  const row = { ...args, area, ...(also ? { also_areas: normalizeAreas(also, area) } : {}) };
  return ok(unwrap(await db.from('entries').upsert(row).select(COLS).single()));
}

export function registerEntryTools(server: McpServer) {
  server.registerTool(
    'list_entries',
    {
      title: 'List entries',
      description:
        `List saved entries (the sorted side of the second brain), newest first. Filter by area (free text, see list_areas; matches the main area or also_areas), ` +
        `category, a single tag, source_platform, exact url (all entries filed from one source), ` +
        `upload_id (all entries filed from one uploaded file), or since (ISO timestamp, created_at >=). Soft-deleted entries are hidden unless include_deleted. ` +
        `brief:true returns only id, area, also_areas, name, url, category, tags, description, comment, source_platform, source_author_handle, source_title, upload_id, created_at (no notes_md, no file) — use it to scan many entries.`,
      inputSchema: {
        area: z.string().optional(),
        category: z.string().optional(),
        tag: z.string().optional(),
        source_platform: z.enum(SOURCE_PLATFORMS).optional(),
        url: z.string().optional(),
        upload_id: z.string().optional(),
        since: z.string().optional(),
        include_deleted: z.boolean().optional(),
        limit: z.number().int().positive().max(500).optional(),
        brief: z.boolean().optional(),
      },
    },
    async ({ area, category, tag, source_platform, url, upload_id, since, include_deleted, limit, brief }) =>
      guard(async () => {
        let q = db
          .from('entries')
          .select(brief ? COLS_BRIEF : COLS_READ)
          .order('created_at', { ascending: false });
        if (!include_deleted) q = q.is('deleted_at', null);
        if (area) q = q.or(areaFilter(normalizeArea(area)));
        if (category) q = q.eq('category', category);
        if (tag) q = q.contains('tags', [tag]);
        if (source_platform) q = q.eq('source_platform', source_platform);
        if (url) q = q.eq('url', url);
        if (upload_id) q = q.eq('upload_id', upload_id);
        if (since) q = q.gte('created_at', since);
        if (limit) q = q.limit(limit);
        return ok(unwrap(await q));
      }),
  );

  server.registerTool(
    'find_entry',
    {
      title: 'Find entry',
      description:
        "Full-text search across entries (the user's comment, name, tags, description, category, source author/title, notes), optionally within one area (main area or also_areas). " +
        "The user's comment (their own reason for saving the find) and the tags are part of the search. Hits come back unranked (no relevance order); weighing them by comment is up to the caller. " +
        'Run this before upsert_entry to avoid duplicates. Excludes soft-deleted entries. ' +
        'brief:true returns only id, area, also_areas, name, url, category, tags, description, comment, source_platform, source_author_handle, source_title, upload_id, created_at (no notes_md, no file) — use it to scan many hits.',
      inputSchema: { query: z.string(), area: z.string().optional(), brief: z.boolean().optional() },
    },
    async ({ query, area, brief }) =>
      guard(async () => {
        let q = db
          .from('entries')
          .select(brief ? COLS_BRIEF : COLS_READ)
          .is('deleted_at', null)
          .textSearch('search', query, { type: 'websearch', config: 'simple' });
        if (area) q = q.or(areaFilter(normalizeArea(area)));
        return ok(unwrap(await q));
      }),
  );

  server.registerTool(
    'upsert_entry',
    {
      title: 'Upsert entry',
      description:
        'Create or update one saved entry — an article, video, podcast, PDF, post or idea worth keeping. ' +
        'Pass id to update, omit to create. Run find_entry first; on a hit pass its id and APPEND a dated section to notes_md, never overwrite. ' +
        'One find that serves two themes is ONE entry: main area in area, the other in also_areas — never file it twice. ' +
        'Two different finds from one source (e.g. what a video shows vs. the technique it uses) are two entries with the same url, one call each. ' +
        "comment: the user's own words on why they saved it — copy the dump item's note verbatim (never paraphrase, never invent one; leave empty without a note). " +
        'When updating an existing entry, append a dated line ("YYYY-MM-DD: …") to the stored comment instead of overwriting it. ' +
        'If that new note points to another area, add that area to also_areas (pass the full list: stored also_areas plus the new one) — or file a separate entry if it is a different aspect of the source. ' +
        `area is the load-bearing field: ${AREA_RULES} ` +
        'category is free text within the area; reuse categories already used there (list_entries {area, brief:true}) for consistent grouping. ' +
        'source_* describe where it came from (platform, media type, author, handle, title, published date as YYYY-MM-DD, ' +
        'duration in seconds for video/audio, word count for text, page count for PDFs): omit rather than guess. ' +
        'captured_at is when the item entered the dump (defaults to now). tags: 3–8 kebab-case tags incl. spelling variants of the core term (e.g. meal-prep, mealprep). ' +
        'upload_id: the uploaded file the entry comes from — pass the dump item\'s upload.id, set source_platform "upload" and leave url null for a pure file item; dedup file items with list_entries {upload_id}.',
      inputSchema: ENTRY_FIELDS,
    },
    async (args) => guard(() => upsertEntry(args)),
  );

  server.registerTool(
    'delete_entry',
    {
      title: 'Delete entry',
      description: 'Soft-delete an entry: disappears from the app but stays in the database (recoverable via restore_entry).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('entries').update({ deleted_at: new Date().toISOString() }).eq('id', id));
        return ok({ deleted: id });
      }),
  );

  server.registerTool(
    'restore_entry',
    {
      title: 'Restore entry',
      description: 'Undo a soft-delete: bring a deleted entry back into the app.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('entries').update({ deleted_at: null }).eq('id', id));
        return ok({ restored: id });
      }),
  );

  server.registerTool(
    'list_areas',
    {
      title: 'List areas',
      description:
        'List the areas (free-text topics) in use, with how many live rows carry each, most used first: ' +
        '`entries` counts saved entries (main area or also_areas), `learnings` counts wiki pages. ' +
        'Areas are not predefined — they are exactly the values that exist. Call this before filing an entry or a learning and reuse an existing name whenever it fits; ' +
        'an empty list means a fresh start, then name a short, lowercase topic.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const rows = unwrap(await db.from('area_usage').select('source,area,count').order('count', { ascending: false })) ?? [];
        const pick = (source: string) =>
          rows
            .filter((r) => r.source === source && r.area)
            .map(({ area, count }) => ({ area: area as string, count: count ?? 0 }));
        return ok({ entries: pick('entries'), learnings: pick('learnings') });
      }),
  );
}
