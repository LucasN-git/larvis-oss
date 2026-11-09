import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LEARNWEB_VIDEO_STATUSES } from '@larvis/shared';
import { syncLearnweb } from '@larvis/shared/learnweb';
import { db } from '../supabase.js';
import { fail, guard, ok, unwrap } from '../util.js';

// Alle Tools lesen aus dem Supabase-Cache; nur learnweb_sync spricht (read-only)
// mit Learnweb, und learnweb_queue_transcription schreibt einen Status im Cache.
// Video-Listen laden bewusst NICHT transcript_md/segments.
const COURSE_COLS =
  'id,moodle_id,project_id,fullname,shortname,url,startdate,enddate,visible,last_synced_at,first_seen_at,created_at,updated_at,deleted_at';
const ITEM_COLS =
  'id,course_id,cmid,section_id,section_name,subsection_name,modtype,type_label,name,url,size_text,sort_order,first_seen_at,deleted_at';
const VIDEO_LIST_COLS =
  'id,course_id,episode_key,kind,title,duration_seconds,recorded_at,episode_url,status,model,transcribed_at,error,first_seen_at';
const ANNOUNCEMENT_COLS = 'id,course_id,discussion_id,subject,author,posted_at,body_text,url,pinned,first_seen_at';
const EVENT_COLS = 'id,event_id,course_id,name,modulename,starts_at,url';

export function registerLearnwebTools(server: McpServer) {
  server.registerTool(
    'learnweb_sync',
    {
      title: 'Learnweb-Sync',
      description:
        'Synchronisiert Learnweb (Moodle Uni Münster) read-only in den Cache: Kurse, Materialien, Ankündigungen, Termine und eLectures. Loggt sich ein und liest — schreibt NIE nach Learnweb. Ohne course_id werden alle laufenden Kurse tief gesynct (kann dauern). Danach liefern die anderen learnweb_*-Tools frische Daten.',
      inputSchema: { course_id: z.number().optional() },
    },
    async ({ course_id }) =>
      guard(async () => ok(await syncLearnweb(db, { courseId: course_id }))),
  );

  server.registerTool(
    'learnweb_list_courses',
    {
      title: 'Learnweb-Kurse auflisten',
      description:
        'Listet die belegten Learnweb-Kurse aus dem Cache. Standardmäßig nur laufende/aktuelle Kurse; include_past=true auch abgeschlossene. Bei Bedarf vorher learnweb_sync.',
      inputSchema: { include_past: z.boolean().optional() },
    },
    async ({ include_past }) =>
      guard(async () => {
        let q = db.from('learnweb_courses').select(COURSE_COLS).is('deleted_at', null);
        if (!include_past) q = q.or(`enddate.is.null,enddate.gt.${new Date().toISOString()}`);
        return ok(unwrap(await q.order('fullname', { ascending: true })));
      }),
  );

  server.registerTool(
    'learnweb_get_course',
    {
      title: 'Learnweb-Kurs abrufen',
      description:
        'Kompletter Kurskontext aus dem Cache: Kurs, Materialien (nach Sektion), letzte Ankündigungen (gekürzt), Videos (mit Transkript-Status, ohne Volltext) und anstehende Termine. course_id ist die Moodle-Kurs-Id (z. B. 12345).',
      inputSchema: { course_id: z.number() },
    },
    async ({ course_id }) =>
      guard(async () => {
        const course = unwrap(
          await db.from('learnweb_courses').select(COURSE_COLS).eq('moodle_id', course_id).is('deleted_at', null).maybeSingle(),
        );
        if (!course) return fail(`Kurs ${course_id} nicht im Cache. Vorher learnweb_sync ausführen.`);
        const id = (course as { id: string }).id;
        const [items, announcements, videos, events] = await Promise.all([
          db.from('learnweb_items').select(ITEM_COLS).eq('course_id', id).is('deleted_at', null).order('sort_order', { ascending: true }),
          db.from('learnweb_announcements').select(ANNOUNCEMENT_COLS).eq('course_id', id).is('deleted_at', null).order('posted_at', { ascending: false, nullsFirst: false }).limit(10),
          db.from('learnweb_videos').select(VIDEO_LIST_COLS).eq('course_id', id).is('deleted_at', null).order('recorded_at', { ascending: false, nullsFirst: false }),
          db.from('learnweb_events').select(EVENT_COLS).eq('course_id', id).is('deleted_at', null).order('starts_at', { ascending: true }),
        ]);
        const anns = (unwrap(announcements) as Array<{ body_text: string }>).map((a) => ({
          ...a,
          body_text: a.body_text.length > 500 ? a.body_text.slice(0, 500) + '…' : a.body_text,
        }));
        return ok({ course, items: unwrap(items), announcements: anns, videos: unwrap(videos), events: unwrap(events) });
      }),
  );

  server.registerTool(
    'learnweb_list_videos',
    {
      title: 'Learnweb-Videos auflisten',
      description:
        'Listet eLectures (Vorlesungsaufzeichnungen) aus dem Cache mit Transkript-Status (ohne Volltext). Optional nach Kurs (Moodle-Id) und Status filtern.',
      inputSchema: {
        course_id: z.number().optional(),
        status: z.enum(LEARNWEB_VIDEO_STATUSES).optional(),
      },
    },
    async ({ course_id, status }) =>
      guard(async () => {
        let q = db.from('learnweb_videos').select(VIDEO_LIST_COLS).is('deleted_at', null);
        if (course_id) {
          const course = unwrap(await db.from('learnweb_courses').select('id').eq('moodle_id', course_id).maybeSingle());
          if (!course) return fail(`Kurs ${course_id} nicht im Cache.`);
          q = q.eq('course_id', (course as { id: string }).id);
        }
        if (status) q = q.eq('status', status);
        return ok(unwrap(await q.order('recorded_at', { ascending: false, nullsFirst: false })));
      }),
  );

  server.registerTool(
    'learnweb_get_transcript',
    {
      title: 'Learnweb-Transkript abrufen',
      description:
        'Volltext-Transkript einer eLecture (video_id aus learnweb_list_videos / learnweb_get_course). format markdown (Absätze mit Zeitmarken) oder segments (Liste {start,end,text}).',
      inputSchema: {
        video_id: z.string(),
        format: z.enum(['markdown', 'segments']).optional(),
      },
    },
    async ({ video_id, format }) =>
      guard(async () => {
        const v = unwrap(
          await db.from('learnweb_videos').select('id,title,status,model,transcribed_at,transcript_md,segments').eq('id', video_id).maybeSingle(),
        ) as { title: string; status: string; transcript_md: string; segments: unknown } | null;
        if (!v) return fail('Video nicht gefunden.');
        if (v.status !== 'done') {
          return fail(`Noch kein Transkript (Status: ${v.status}). Mit learnweb_queue_transcription einreihen und lokal transkribieren.`);
        }
        return ok(format === 'segments' ? { title: v.title, segments: v.segments } : { title: v.title, transcript_md: v.transcript_md });
      }),
  );

  server.registerTool(
    'learnweb_search_transcripts',
    {
      title: 'Learnweb-Transkripte durchsuchen',
      description:
        'Volltextsuche über die Transkripte der eLectures (und Ankündigungen). Liefert Treffer mit Titel, Kurs-Bezug und Textausschnitt. Optional auf einen Kurs (Moodle-Id) einschränken.',
      inputSchema: { query: z.string(), course_id: z.number().optional() },
    },
    async ({ query, course_id }) =>
      guard(async () => {
        let courseUuid: string | undefined;
        if (course_id) {
          const c = unwrap(await db.from('learnweb_courses').select('id').eq('moodle_id', course_id).maybeSingle());
          if (!c) return fail(`Kurs ${course_id} nicht im Cache.`);
          courseUuid = (c as { id: string }).id;
        }
        let vq = db
          .from('learnweb_videos')
          .select('id,course_id,title,transcript_md')
          .is('deleted_at', null)
          .textSearch('search', query, { type: 'websearch', config: 'simple' });
        if (courseUuid) vq = vq.eq('course_id', courseUuid);
        const videos = unwrap(await vq) as Array<{ id: string; course_id: string; title: string; transcript_md: string }>;

        const hits = videos.map((v) => ({
          video_id: v.id,
          course_id: v.course_id,
          title: v.title,
          snippet: snippet(v.transcript_md, query),
        }));
        return ok({ query, hits });
      }),
  );

  server.registerTool(
    'learnweb_queue_transcription',
    {
      title: 'Learnweb-Transkription vormerken',
      description:
        'Merkt eine eLecture zur lokalen Transkription vor (setzt nur status=queued im Cache). Die Transkription selbst läuft lokal auf dem eigenen Rechner (scripts/learnweb/transcribe-queue.mjs) mit faster-whisper — dieses Tool startet sie NICHT.',
      inputSchema: { video_id: z.string() },
    },
    async ({ video_id }) =>
      guard(async () => {
        unwrap(await db.from('learnweb_videos').update({ status: 'queued', error: null }).eq('id', video_id));
        return ok({ queued: video_id });
      }),
  );

  server.registerTool(
    'learnweb_link_project',
    {
      title: 'Learnweb-Kurs mit Projekt verknüpfen',
      description:
        'Verknüpft einen Learnweb-Kurs mit einem Larvis-Projekt (oder löst die Verknüpfung mit project_id=null). Das Projekt zeigt danach einen Learnweb-Tab mit Kursinhalten, Ankündigungen und Videos. course_id ist die Moodle-Kurs-Id. Projekt anlegen geht separat über create_project.',
      inputSchema: { course_id: z.number(), project_id: z.string().nullable() },
    },
    async ({ course_id, project_id }) =>
      guard(async () => {
        const updated = unwrap(
          await db
            .from('learnweb_courses')
            .update({ project_id })
            .eq('moodle_id', course_id)
            .is('deleted_at', null)
            .select('id,moodle_id,fullname,project_id')
            .maybeSingle(),
        );
        if (!updated) return fail(`Kurs ${course_id} nicht im Cache. Vorher learnweb_sync ausführen.`);
        return ok(updated);
      }),
  );
}

/** Textausschnitt um den ersten Treffer eines Suchbegriffs (±300 Zeichen). */
function snippet(text: string, query: string): string {
  if (!text) return '';
  const terms = query.split(/\s+/).filter((t) => t.length > 2);
  let idx = -1;
  for (const t of terms) {
    idx = text.toLowerCase().indexOf(t.toLowerCase());
    if (idx >= 0) break;
  }
  if (idx < 0) return text.slice(0, 300).trim() + (text.length > 300 ? '…' : '');
  const start = Math.max(0, idx - 300);
  const end = Math.min(text.length, idx + 300);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}
