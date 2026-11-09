import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  LEARNING_SLUG_RE,
  LEARNING_SOURCE_ROLES,
  LEARNING_SOURCE_ROLE_LABELS,
  attachmentRef,
  descendantIds,
  normalizeArea,
  removeInlineImage,
} from '@larvis/shared';
import { db, OWNER_ID } from '../supabase.js';
import { areaFilter, fail, guard, ok, unwrap } from '../util.js';

// Learnings = das kuratierte Wiki (Tab „Learnings"). Die Tool-Beschreibungen sind der
// Vertrag für Claude: sie erklären Wiki vs. Notizen, die Bereiche, die Slug-Regel und den
// Grafik-Ablauf.

const COLS =
  'id,area,parent_id,slug,title,summary,body_md,tags,sort_order,created_at,updated_at,deleted_at';
// Ohne body_md: die Baumansicht braucht die Inhalte nicht, und Seiten können lang sein.
const TREE_COLS =
  'id,area,parent_id,slug,title,summary,tags,sort_order,created_at,updated_at,deleted_at';
// Belege mit eingebetteter Quelle: der Eintrag knapp (Name, URL, Kommentar), die Notiz
// mit Titel und Projekt — genug, um die Quelle zu erkennen, ohne sie nachzuladen.
const SOURCE_COLS =
  'id,learning_id,entry_id,note_id,role,comment,sort_order,created_at,' +
  'entry:entries(id,area,name,url,comment,description,source_author,source_platform,deleted_at),' +
  'note:notes(id,title,project_id,area,deleted_at)';
const ATTACH_COLS =
  'id,learning_id,storage_path,filename,mime_type,size_bytes,kind,inline,sort_order,created_at';
const BUCKET = 'learning-files';

// Bildformate, die das Upload-Tool annimmt (der Bucket selbst ist nicht beschränkt —
// PDFs hängt der Nutzer in der App an). SVG ist der Normalfall für Claude-Grafiken.
const IMAGE_MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
// Bewusst kleine Obergrenze: base64 kostet ein Drittel Aufschlag, ein 3-MB-Bild
// wird im MCP-Request zu ~4 MB. Der Node-Server nähme bis 25 MB an
// (apps/web/server/index.mjs); Wiki-Grafiken brauchen weit weniger.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const ROLE_HINT = LEARNING_SOURCE_ROLES.map((r) => `'${r}' (${LEARNING_SOURCE_ROLE_LABELS[r]})`).join(', ');

const WIKI_RULES =
  'Learnings are the user\'s curated wiki (app tab "Learnings") — NOT notes and NOT entries. An entry (upsert_entry) is a saved find by someone else, a note (create_note) is the user\'s own quick dump; ' +
  'a learning is the user\'s OWN claim distilled from them: a position they hold, written as the polished, current-state write-up — full German sentences, present tense ("so ist es"), no changelog, ' +
  '## headings (Aussage → Begründung → Offene Fragen), and a diagram where it helps (see upload_learning_image). ' +
  'A page states what the user thinks, never a summary of its sources; the sources hang on the page as linked evidence (link_learning_source). ' +
  'Areas are free-text topics, the same kind as entry areas: call list_areas and reuse an existing name (exact spelling) before introducing a new one; stored lowercase and trimmed. ' +
  'A page lives in the area where its claim holds (an entry from one area can back a learning in another). Pages form a tree per area (parent_slug). ' +
  'The slug is the stable address: URL /learnings/<slug>, upsert key, and target of internal links written as [Text](/learnings/<slug>). ' +
  'Never change a slug once created — renaming means a new page.';

type LearningRow = {
  id: string;
  area: string;
  parent_id: string | null;
  slug: string;
  deleted_at: string | null;
};

/** Live page by slug (null if unknown or soft-deleted). */
async function liveBySlug(slug: string): Promise<LearningRow | null> {
  const row = unwrap(
    await db.from('learnings').select('id,area,parent_id,slug,deleted_at').eq('slug', slug).is('deleted_at', null).maybeSingle(),
  );
  return row;
}

/** Signed download URLs for a page's attachments (~1h). */
async function attachmentsWithUrls(learningId: string) {
  const rows = unwrap(
    await db
      .from('learning_attachments')
      .select(ATTACH_COLS)
      .eq('learning_id', learningId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  );
  return Promise.all(
    (rows ?? []).map(async (r) => {
      const { data } = await db.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600);
      const label = (r.filename ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/[[\]()]/g, '').trim() || 'Bild';
      const ref = attachmentRef(r.id);
      return {
        ...r,
        signed_url: data?.signedUrl ?? null,
        ref,
        markdown: r.kind === 'image' ? `![${label}](${ref})` : `[${label}](${ref})`,
      };
    }),
  );
}

/** Belege einer Seite, lebende Quellen zuerst erkennbar (deleted_at der Quelle wird mitgeliefert). */
async function sourcesOf(learningId: string) {
  const rows = unwrap(
    await db
      .from('learning_sources')
      .select(SOURCE_COLS)
      .eq('learning_id', learningId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  );
  return rows ?? [];
}

function extOf(filename: string): string {
  const raw = filename.includes('.') ? filename.split('.').pop()! : '';
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
}

export function registerLearningTools(server: McpServer) {
  server.registerTool(
    'list_learnings',
    {
      title: 'List learnings',
      description:
        `List wiki pages (without body_md — use get_learning for content), optionally one area. Returns the tree columns (parent_id, slug, title, summary, tags, sort_order) so you can see the structure and pick a parent_slug. ${WIKI_RULES}`,
      inputSchema: {
        area: z.string().optional(),
        include_deleted: z.boolean().optional(),
      },
    },
    async ({ area, include_deleted }) =>
      guard(async () => {
        let q = db.from('learnings').select(TREE_COLS);
        if (!include_deleted) q = q.is('deleted_at', null);
        if (area) q = q.eq('area', normalizeArea(area));
        return ok(unwrap(await q.order('area').order('sort_order').order('title')));
      }),
  );

  server.registerTool(
    'get_learning',
    {
      title: 'Get learning',
      description:
        'Get one wiki page by slug (or id) with its full body_md, its attachments (metadata, a temporary signed URL, and the markdown ref to embed each image) and its sources (linked entries/notes with role and comment). Also finds soft-deleted pages. Read a page with this before rewriting it via upsert_learning.',
      inputSchema: {
        slug: z.string().optional(),
        id: z.string().optional(),
      },
    },
    async ({ slug, id }) =>
      guard(async () => {
        if (!slug && !id) return fail('Pass slug or id.');
        let q = db.from('learnings').select(COLS);
        q = slug ? q.eq('slug', slug) : q.eq('id', id!);
        const row = unwrap(await q.maybeSingle());
        if (!row) return fail(`No learning with ${slug ? `slug '${slug}'` : `id '${id}'`}.`);
        return ok({ ...row, attachments: await attachmentsWithUrls(row.id), sources: await sourcesOf(row.id) });
      }),
  );

  server.registerTool(
    'upsert_learning',
    {
      title: 'Upsert learning',
      description:
        `Create or fully rewrite a wiki page (upsert on slug; a soft-deleted page with that slug comes back live). body_md REPLACES the stored body, so call get_learning first and write the complete new text — never a fragment. ${WIKI_RULES} ` +
        'parent_slug nests the page under another page of the same area (null = top level; omit to leave unchanged). ' +
        'summary is a one-sentence teaser shown under the title. ' +
        'Where the page comes from (entries, notes) is NOT part of this call: link each source afterwards with link_learning_source; the sources stay as they are. ' +
        'Embed diagrams by uploading them with upload_learning_image and pasting the returned markdown ref. Never put secrets or keys into a page.',
      inputSchema: {
        slug: z.string().regex(LEARNING_SLUG_RE, 'kebab-case: a-z, 0-9, single hyphens'),
        area: z.string().min(1).describe('Free-text area (topic). Reuse a name from list_areas.'),
        title: z.string().min(1),
        body_md: z.string(),
        summary: z.string().nullable().optional(),
        parent_slug: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        sort_order: z.number().int().optional(),
      },
    },
    async ({ slug, area: rawArea, title, body_md, summary, parent_slug, tags, sort_order }) =>
      guard(async () => {
        const area = normalizeArea(rawArea);
        if (!area) return fail('area must not be empty — pick one from list_areas or name a new one.');
        const existing = unwrap(
          await db.from('learnings').select('id,area,parent_id,slug,deleted_at').eq('slug', slug).maybeSingle(),
        );

        // parent_slug → parent_id: must exist, be live, sit in the same area, and not
        // be the page itself or one of its descendants (no cycles).
        let parent_id: string | null | undefined = undefined;
        if (parent_slug === null) parent_id = null;
        else if (parent_slug !== undefined) {
          const parent = await liveBySlug(parent_slug);
          if (!parent) return fail(`Parent '${parent_slug}' not found (or deleted).`);
          if (parent.area !== area) return fail(`Parent '${parent_slug}' is in area '${parent.area}', not '${area}'.`);
          if (existing) {
            if (parent.id === existing.id) return fail('A page cannot be its own parent.');
            const pages = unwrap(await db.from('learnings').select('id,parent_id').is('deleted_at', null));
            if (descendantIds(pages ?? [], existing.id).has(parent.id)) {
              return fail(`'${parent_slug}' is a descendant of '${slug}' — that would create a cycle.`);
            }
          }
          parent_id = parent.id;
        }

        const payload = {
          slug,
          area,
          title: title.trim(),
          body_md,
          deleted_at: null,
          ...(summary !== undefined ? { summary: summary?.trim() || null } : {}),
          ...(parent_id !== undefined ? { parent_id } : {}),
          ...(tags ? { tags } : {}),
          ...(sort_order !== undefined ? { sort_order } : {}),
        };
        return ok(unwrap(await db.from('learnings').upsert(payload, { onConflict: 'slug' }).select(COLS).single()));
      }),
  );

  server.registerTool(
    'delete_learning',
    {
      title: 'Delete learning',
      description:
        'Soft-delete a wiki page by slug: it disappears from the app but stays in the database (recoverable via restore_learning). Attachments stay. Child pages move to the top level of their area only visually — their parent_id is untouched, so restoring the parent brings the tree back.',
      inputSchema: { slug: z.string() },
    },
    async ({ slug }) =>
      guard(async () => {
        const row = unwrap(
          await db.from('learnings').update({ deleted_at: new Date().toISOString() }).eq('slug', slug).select('id').maybeSingle(),
        );
        if (!row) return fail(`No learning with slug '${slug}'.`);
        return ok({ deleted: slug });
      }),
  );

  server.registerTool(
    'restore_learning',
    {
      title: 'Restore learning',
      description: 'Undo a soft-delete: bring a deleted wiki page back into the app.',
      inputSchema: { slug: z.string() },
    },
    async ({ slug }) =>
      guard(async () => {
        const row = unwrap(await db.from('learnings').update({ deleted_at: null }).eq('slug', slug).select('id').maybeSingle());
        if (!row) return fail(`No learning with slug '${slug}'.`);
        return ok({ restored: slug });
      }),
  );

  server.registerTool(
    'upload_learning_image',
    {
      title: 'Upload learning image',
      description:
        'Upload a diagram or picture for a wiki page and get back the markdown ref to paste into body_md (e.g. ![Aufbau](larvis-att:<id>)). ' +
        'The page must already exist and be live — create it with upsert_learning first (uploading to an unknown or deleted slug fails). ' +
        'Pass the bytes as content_base64 (for a local file: base64-encode it first, e.g. `base64 -i diagram.svg`). ' +
        `Formats: ${Object.keys(IMAGE_MIME).join(', ')}; max ${MAX_IMAGE_BYTES / 1024 / 1024} MB. ` +
        'Prefer hand-written SVG: set viewBox and width ≤ 900, transparent background, font-family system-ui, no external refs or scripts. ' +
        'The app renders pages in light AND dark theme, so use mid-tone colors readable on both (strokes/text ~#7A8089, box fills with alpha like rgba(128,134,144,0.12), accent #E0571F) — never pure black or white. ' +
        'After uploading, write the ref into the page via upsert_learning (the image is not shown until it is referenced in body_md).',
      inputSchema: {
        slug: z.string(),
        filename: z.string().min(1),
        content_base64: z.string().min(1),
        mime_type: z.string().optional(),
        alt: z.string().optional(),
      },
    },
    async ({ slug, filename, content_base64, mime_type, alt }) =>
      guard(async () => {
        const page = await liveBySlug(slug);
        if (!page) return fail(`No live learning with slug '${slug}'.`);

        const ext = extOf(filename);
        const mime = mime_type ?? IMAGE_MIME[ext];
        if (!mime || !Object.values(IMAGE_MIME).includes(mime)) {
          return fail(`Unsupported image type (${mime ?? (ext || 'unknown')}). Allowed: ${Object.keys(IMAGE_MIME).join(', ')}.`);
        }

        // Bewusst nur base64, kein Dateipfad: das Tool ist auch über den Remote-Endpunkt
        // erreichbar, und ein Pfad-Parameter wäre ein beliebiger Datei-Lesezugriff auf dem
        // Server (z. B. /proc/self/environ mit dem Service-Role-Key), abrufbar als signierte URL.
        const b64 = content_base64.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) {
          return fail(
            'content_base64 is not valid base64 — pass the encoded bytes (e.g. `base64 -i diagram.svg`), not the raw file text and not a data: URL.',
          );
        }
        const bytes = Buffer.from(b64, 'base64');
        if (bytes.length === 0) return fail('Empty file (content_base64 did not decode to any bytes).');
        if (bytes.length > MAX_IMAGE_BYTES) return fail(`File too large (${bytes.length} bytes, max ${MAX_IMAGE_BYTES}).`);

        // Erstes Pfadsegment = Owner-UUID: die Web-App liest über Storage-RLS.
        const path = `${OWNER_ID}/${page.id}/${randomUUID()}.${ext || 'bin'}`;
        const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
        if (up.error) return fail(`Upload failed: ${up.error.message}`);

        const { data, error } = await db
          .from('learning_attachments')
          .insert({
            learning_id: page.id,
            storage_path: path,
            filename,
            mime_type: mime,
            size_bytes: bytes.length,
            kind: 'image',
            inline: true,
          })
          .select(ATTACH_COLS)
          .single();
        if (error) {
          // Zeile fehlgeschlagen — kein verwaistes Objekt zurücklassen.
          await db.storage.from(BUCKET).remove([path]).catch(() => {});
          return fail(error.message);
        }
        const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
        const label = (alt ?? filename.replace(/\.[a-z0-9]+$/i, '')).replace(/[[\]()]/g, '').trim() || 'Bild';
        return ok({ attachment: data, markdown: `![${label}](${attachmentRef(data.id)})`, signed_url: signed?.signedUrl ?? null });
      }),
  );

  server.registerTool(
    'link_learning_source',
    {
      title: 'Link learning source',
      description:
        'Attach a source to a wiki page: exactly one of entry_id (a saved find, see list_entries/find_entry) or note_id (the user\'s own note). ' +
        `role: ${ROLE_HINT} — 'beleg' backs the claim, 'beispiel' shows it on a concrete case, 'gegenbeispiel' contradicts or qualifies it, 'erfahrung' is the user's own observation (typically a note). ` +
        'comment: one sentence on what THIS source shows for the claim (optional). The same source links to a page only once; linking it again updates role and comment. ' +
        'The page shows its sources under "Belege", the entry shows "fließt ein in". Use this after upsert_learning for every entry or note the page is distilled from.',
      inputSchema: {
        slug: z.string(),
        entry_id: z.string().optional(),
        note_id: z.string().optional(),
        role: z.enum(LEARNING_SOURCE_ROLES).optional(),
        comment: z.string().optional(),
        sort_order: z.number().int().optional(),
      },
    },
    async ({ slug, entry_id, note_id, role, comment, sort_order }) =>
      guard(async () => {
        if (Boolean(entry_id) === Boolean(note_id)) return fail('Pass exactly one of entry_id or note_id.');
        const page = await liveBySlug(slug);
        if (!page) return fail(`No live learning with slug '${slug}'.`);
        if (entry_id) {
          const e = unwrap(await db.from('entries').select('id,deleted_at').eq('id', entry_id).maybeSingle());
          if (!e) return fail(`No entry with id '${entry_id}'.`);
          if (e.deleted_at) return fail(`Entry '${entry_id}' is deleted — restore_entry first.`);
        } else {
          const n = unwrap(await db.from('notes').select('id,deleted_at').eq('id', note_id!).maybeSingle());
          if (!n) return fail(`No note with id '${note_id}'.`);
          if (n.deleted_at) return fail(`Note '${note_id}' is deleted.`);
        }
        const payload = {
          learning_id: page.id,
          entry_id: entry_id ?? null,
          note_id: note_id ?? null,
          ...(role ? { role } : {}),
          ...(comment !== undefined ? { comment: comment.trim() } : {}),
          ...(sort_order !== undefined ? { sort_order } : {}),
        };
        const row = unwrap(
          await db
            .from('learning_sources')
            .upsert(payload, { onConflict: entry_id ? 'learning_id,entry_id' : 'learning_id,note_id' })
            .select(SOURCE_COLS)
            .single(),
        );
        return ok(row);
      }),
  );

  server.registerTool(
    'unlink_learning_source',
    {
      title: 'Unlink learning source',
      description: 'Remove one source link from a wiki page by the link id (from get_learning → sources). The entry or note itself stays.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        const row = unwrap(await db.from('learning_sources').delete().eq('id', id).select('id').maybeSingle());
        if (!row) return fail(`No learning source with id '${id}'.`);
        return ok({ deleted: id });
      }),
  );

  server.registerTool(
    'list_undistilled',
    {
      title: 'List undistilled sources',
      description:
        'The backlog for distilling the wiki: live entries (saved finds) that no live learning links as a source yet; with include_notes: true also live notes (incl. archived) without a link. ' +
        'area filters entries only (main area or also_areas match); notes are never filtered by area. ' +
        'since (ISO timestamp) filters both by created_at >=. limit (default 100, max 500) caps each list; *_total is the count before the cap. ' +
        'Entries come brief (id, area, also_areas, name, url, comment, description, tags, created_at), notes as (id, title, area, project_id, created_at). ' +
        'Use it to propose which existing claim a find strengthens or contradicts, or which new claim it suggests; the user decides, then upsert_learning + link_learning_source.',
      inputSchema: {
        area: z.string().optional(),
        since: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        include_notes: z.boolean().optional(),
      },
    },
    async ({ area, since, limit, include_notes }) =>
      guard(async () => {
        const links = unwrap(
          await db.from('learning_sources').select('entry_id,note_id,learning:learnings!inner(deleted_at)'),
        );
        const linkedEntries = new Set<string>();
        const linkedNotes = new Set<string>();
        for (const l of links ?? []) {
          const learning = l.learning as unknown as { deleted_at: string | null } | null;
          if (learning?.deleted_at) continue;
          if (l.entry_id) linkedEntries.add(l.entry_id);
          if (l.note_id) linkedNotes.add(l.note_id);
        }
        let eq = db
          .from('entries')
          .select('id,area,also_areas,name,url,comment,description,tags,created_at')
          .is('deleted_at', null);
        if (area) eq = eq.or(areaFilter(normalizeArea(area)));
        if (since) eq = eq.gte('created_at', since);
        const entries = (unwrap(await eq.order('created_at', { ascending: false })) ?? []).filter((e) => !linkedEntries.has(e.id));
        let notes: unknown[] = [];
        if (include_notes) {
          let nq = db.from('notes').select('id,title,area,project_id,created_at').is('deleted_at', null);
          if (since) nq = nq.gte('created_at', since);
          notes = (unwrap(await nq.order('created_at', { ascending: false })) ?? []).filter((n) => !linkedNotes.has(n.id));
        }
        const cap = limit ?? 100;
        return ok({
          entries: entries.slice(0, cap),
          entries_total: entries.length,
          notes: notes.slice(0, cap),
          notes_total: notes.length,
        });
      }),
  );

  server.registerTool(
    'list_learning_attachments',
    {
      title: 'List learning attachments',
      description:
        'List the images/files of a wiki page: metadata, a temporary signed URL (~1h), `ref` (the bare larvis-att:<id>) and `markdown` (the line to paste into body_md — an image embed for kind=\'image\', a link otherwise). inline=true means it is referenced in body_md.',
      inputSchema: { slug: z.string() },
    },
    async ({ slug }) =>
      guard(async () => {
        const row = unwrap(await db.from('learnings').select('id').eq('slug', slug).maybeSingle());
        if (!row) return fail(`No learning with slug '${slug}'.`);
        return ok(await attachmentsWithUrls(row.id));
      }),
  );

  server.registerTool(
    'delete_learning_attachment',
    {
      title: 'Delete learning attachment',
      description:
        'Permanently remove an image/file from a wiki page: deletes the storage object and the row, and strips its ![…](larvis-att:<id>) ref from the page body when it was inline.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        const att = unwrap(await db.from('learning_attachments').select(ATTACH_COLS).eq('id', id).maybeSingle());
        if (!att) return fail(`No attachment with id '${id}'.`);
        await db.storage.from(BUCKET).remove([att.storage_path]).catch(() => {});
        unwrap(await db.from('learning_attachments').delete().eq('id', id));
        if (att.inline) {
          const page = unwrap(await db.from('learnings').select('id,body_md').eq('id', att.learning_id).maybeSingle());
          if (page) unwrap(await db.from('learnings').update({ body_md: removeInlineImage(page.body_md, id) }).eq('id', page.id));
        }
        return ok({ deleted: id });
      }),
  );
}
