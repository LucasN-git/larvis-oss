// Learnweb-Sync: spiegelt Kurse, Materialien, Ankündigungen, Termine und
// eLectures read-only nach Supabase. Wird identisch vom API-Handler
// (POST /api/learnweb/sync), dem MCP-Tool learnweb_sync und dem lokalen Skript
// (scripts/learnweb/sync-local.mjs) genutzt.
//
// Schreibt NIE nach Learnweb — es werden nur GETs und die beiden erlaubten
// Lese-AJAX-Methoden aufgerufen. Alle Writes gehen ausschließlich in die
// Supabase-Cache-Tabellen. Transkript-Spalten von learnweb_videos werden vom
// Sync nie angefasst (Upserts enthalten nur Metadaten-Spalten).

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types.js';
import {
  LearnwebAuthError,
  type LearnwebSession,
  login,
  lwAjax,
  lwGet,
} from './client.js';
import {
  parseCoursePage,
  parseDiscussionPage,
  parseForumDiscussionList,
  parseOpencastList,
  type ParsedItem,
} from './parsers.js';

type Db = SupabaseClient<Database>;

export interface LearnwebSyncOptions {
  /** Nur diesen Moodle-Kurs tief syncen (sonst alle laufenden Kurse). */
  courseId?: number;
  /** Kursseiten mit unverändertem Hash überspringen (Default true). */
  skipUnchanged?: boolean;
  /** Fortschritts-Logger (z. B. console.log im lokalen Skript). */
  log?: (msg: string) => void;
}

export interface LearnwebSyncReport {
  courses: number;
  deep_synced_courses: number;
  skipped_courses: number;
  new_items: number;
  new_videos: number;
  new_announcements: number;
  new_events: number;
  warnings: string[];
  duration_ms: number;
}

interface MoodleCourse {
  id: number;
  fullname: string;
  shortname?: string;
  startdate?: number;
  enddate?: number;
  visible?: boolean;
  viewurl?: string;
}

interface MoodleEvent {
  id: number;
  name: string;
  modulename?: string;
  timesort?: number;
  url?: string;
  course?: { id?: number };
}

const COURSE_URL = (id: number) => `https://sso.uni-muenster.de/LearnWeb/learnweb2/course/view.php?id=${id}`;
const epochToIso = (sec?: number): string | null => (sec && sec > 0 ? new Date(sec * 1000).toISOString() : null);

/** Session-Halter mit einmaligem Re-Login, falls die Session mitten im Sync stirbt. */
class Session {
  private s: LearnwebSession | null = null;
  async get(): Promise<LearnwebSession> {
    if (!this.s) this.s = await login();
    return this.s;
  }
  async get$(fn: (s: LearnwebSession) => Promise<string>): Promise<string> {
    try {
      return await fn(await this.get());
    } catch (e) {
      if (e instanceof LearnwebAuthError && this.s) {
        this.s = null; // erneut einloggen und ein einziges Mal wiederholen
        return await fn(await this.get());
      }
      throw e;
    }
  }
  async ajax<T>(fn: (s: LearnwebSession) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.get());
    } catch (e) {
      if (e instanceof LearnwebAuthError && this.s) {
        this.s = null;
        return await fn(await this.get());
      }
      throw e;
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hashItems = (items: ParsedItem[]): string =>
  createHash('sha256').update(JSON.stringify(items)).digest('hex');

export async function syncLearnweb(db: Db, opts: LearnwebSyncOptions = {}): Promise<LearnwebSyncReport> {
  const startedAt = Date.now();
  const skipUnchanged = opts.skipUnchanged ?? true;
  const log = opts.log ?? (() => {});
  const report: LearnwebSyncReport = {
    courses: 0,
    deep_synced_courses: 0,
    skipped_courses: 0,
    new_items: 0,
    new_videos: 0,
    new_announcements: 0,
    new_events: 0,
    warnings: [],
    duration_ms: 0,
  };
  const session = new Session();

  // 1) Kursliste (alle belegten Kurse) --------------------------------------
  log('Lade Kursliste …');
  const courseResp = await session.ajax((s) =>
    lwAjax<{ courses: MoodleCourse[] }>(s, 'core_course_get_enrolled_courses_by_timeline_classification', {
      classification: 'all',
      limit: 0,
      offset: 0,
      sort: 'fullname',
    }),
  );
  const courses = courseResp.courses ?? [];
  report.courses = courses.length;

  const courseRows = courses.map((c) => ({
    moodle_id: c.id,
    fullname: c.fullname,
    shortname: c.shortname ?? '',
    url: c.viewurl || COURSE_URL(c.id),
    startdate: epochToIso(c.startdate),
    enddate: epochToIso(c.enddate),
    visible: c.visible ?? true,
    deleted_at: null,
  }));
  if (courseRows.length > 0) {
    const { error } = await db.from('learnweb_courses').upsert(courseRows, { onConflict: 'moodle_id' });
    if (error) throw new Error(`Kurse upsert: ${error.message}`);
  }
  // Verschwundene Kurse soft-deleten (nur nach erfolgreichem Fetch).
  const freshCourseIds = new Set(courses.map((c) => c.id));
  const { data: liveCourses } = await db
    .from('learnweb_courses')
    .select('id, moodle_id')
    .is('deleted_at', null);
  const courseIdMap = new Map<number, string>();
  for (const c of liveCourses ?? []) {
    courseIdMap.set(c.moodle_id, c.id);
    if (!freshCourseIds.has(c.moodle_id)) {
      await db.from('learnweb_courses').update({ deleted_at: new Date().toISOString() }).eq('id', c.id);
    }
  }

  // 2) Anstehende Termine/Abgaben -------------------------------------------
  log('Lade anstehende Termine …');
  try {
    const nowSec = Math.floor(Date.now() / 1000) - 7 * 86400;
    const evResp = await session.ajax((s) =>
      lwAjax<{ events: MoodleEvent[] }>(s, 'core_calendar_get_action_events_by_timesort', {
        timesortfrom: nowSec,
        limitnum: 50,
      }),
    );
    const events = evResp.events ?? [];
    const eventRows = events
      .filter((e) => e.timesort)
      .map((e) => ({
        event_id: e.id,
        course_id: e.course?.id ? courseIdMap.get(e.course.id) ?? null : null,
        name: e.name,
        modulename: e.modulename ?? null,
        starts_at: new Date((e.timesort as number) * 1000).toISOString(),
        url: e.url ?? null,
        deleted_at: null,
      }));
    if (eventRows.length > 0) {
      const existing = new Set(
        (await db.from('learnweb_events').select('event_id')).data?.map((r) => r.event_id) ?? [],
      );
      report.new_events += eventRows.filter((r) => !existing.has(r.event_id)).length;
      const { error } = await db.from('learnweb_events').upsert(eventRows, { onConflict: 'event_id' });
      if (error) report.warnings.push(`Termine upsert: ${error.message}`);
    }
    // Verschwundene zukünftige Termine soft-deleten.
    const freshEventIds = new Set(events.map((e) => e.id));
    const nowIso = new Date().toISOString();
    const { data: liveEvents } = await db
      .from('learnweb_events')
      .select('id, event_id, starts_at')
      .is('deleted_at', null)
      .gt('starts_at', nowIso);
    for (const e of liveEvents ?? []) {
      if (!freshEventIds.has(e.event_id)) {
        await db.from('learnweb_events').update({ deleted_at: nowIso }).eq('id', e.id);
      }
    }
  } catch (e) {
    report.warnings.push(`Termine: ${errMsg(e)}`);
  }

  // 3) Auswahl der tief zu syncenden Kurse ----------------------------------
  let deepCourses: MoodleCourse[];
  if (opts.courseId) {
    deepCourses = courses.filter((c) => c.id === opts.courseId);
    if (deepCourses.length === 0) deepCourses = [{ id: opts.courseId, fullname: `Kurs ${opts.courseId}` }];
  } else {
    try {
      const inProgress = await session.ajax((s) =>
        lwAjax<{ courses: MoodleCourse[] }>(s, 'core_course_get_enrolled_courses_by_timeline_classification', {
          classification: 'inprogress',
          limit: 0,
          offset: 0,
          sort: 'fullname',
        }),
      );
      deepCourses = inProgress.courses ?? [];
    } catch (e) {
      report.warnings.push(`Laufende Kurse: ${errMsg(e)}`);
      deepCourses = [];
    }
  }

  // 4) Pro Kurs: Inhalte, Ankündigungen, eLectures --------------------------
  for (const course of deepCourses) {
    const dbCourseId = courseIdMap.get(course.id);
    if (!dbCourseId) {
      report.warnings.push(`Kurs ${course.id} nicht im Cache — übersprungen.`);
      continue;
    }
    try {
      log(`Sync Kurs „${course.fullname}" …`);
      await syncCourse(db, session, course.id, dbCourseId, skipUnchanged, report);
      report.deep_synced_courses++;
    } catch (e) {
      report.warnings.push(`Kurs „${course.fullname}": ${errMsg(e)}`);
    }
    await sleep(120);
  }

  report.duration_ms = Date.now() - startedAt;
  return report;
}

async function syncCourse(
  db: Db,
  session: Session,
  moodleId: number,
  dbCourseId: string,
  skipUnchanged: boolean,
  report: LearnwebSyncReport,
): Promise<void> {
  const html = await session.get$((s) => lwGet(s, `course/view.php?id=${moodleId}`));
  const { items } = parseCoursePage(html);
  const hash = hashItems(items);

  const { data: courseRow } = await db
    .from('learnweb_courses')
    .select('content_hash')
    .eq('id', dbCourseId)
    .single();

  const unchanged = skipUnchanged && courseRow?.content_hash === hash && hash.length > 0;
  if (unchanged) {
    report.skipped_courses++;
  } else {
    await upsertItems(db, dbCourseId, items, report);
    await db
      .from('learnweb_courses')
      .update({ content_hash: hash, last_synced_at: new Date().toISOString() })
      .eq('id', dbCourseId);
  }

  // Ankündigungen (auch bei unverändertem Hash: das ist die Frische-Fläche).
  const forum = pickAnnouncementForum(items);
  if (forum) {
    try {
      await syncAnnouncements(db, session, dbCourseId, forum.cmid, report);
    } catch (e) {
      report.warnings.push(`Ankündigungen (cmid ${forum.cmid}): ${errMsg(e)}`);
    }
  }

  // eLectures aus Opencast-Aktivitäten.
  const itemIdByCmid = await cmidToItemId(db, dbCourseId);
  for (const oc of items.filter((i) => i.modtype === 'opencast')) {
    try {
      await syncOpencast(db, session, dbCourseId, oc.cmid, itemIdByCmid.get(oc.cmid) ?? null, report);
    } catch (e) {
      report.warnings.push(`eLectures (cmid ${oc.cmid}): ${errMsg(e)}`);
    }
  }

  // mp4-Dateien als zusätzliche Aufzeichnungen (mod/resource, Name endet auf .mp4).
  const fileVideos = items.filter((i) => i.modtype === 'resource' && /\.mp4\b/i.test(i.name));
  if (fileVideos.length > 0) {
    const rows = fileVideos.map((i) => ({
      course_id: dbCourseId,
      item_id: itemIdByCmid.get(i.cmid) ?? null,
      episode_key: `resource:${i.cmid}`,
      kind: 'file' as const,
      title: i.name,
      episode_url: i.url,
      deleted_at: null,
    }));
    const existing = new Set(
      (await db.from('learnweb_videos').select('episode_key').eq('course_id', dbCourseId)).data?.map(
        (r) => r.episode_key,
      ) ?? [],
    );
    report.new_videos += rows.filter((r) => !existing.has(r.episode_key)).length;
    await db.from('learnweb_videos').upsert(rows, { onConflict: 'episode_key' });
  }
}

async function upsertItems(
  db: Db,
  dbCourseId: string,
  items: ParsedItem[],
  report: LearnwebSyncReport,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const rows = items.map((i) => ({
    course_id: dbCourseId,
    cmid: i.cmid,
    section_id: i.sectionId,
    section_name: i.sectionName,
    subsection_name: i.subsectionName,
    modtype: i.modtype,
    type_label: i.typeLabel,
    name: i.name,
    url: i.url,
    size_text: i.sizeText,
    sort_order: i.sortOrder,
    last_seen_at: nowIso,
    deleted_at: null,
  }));
  const existing = new Set(
    (await db.from('learnweb_items').select('cmid').eq('course_id', dbCourseId)).data?.map((r) => r.cmid) ?? [],
  );
  report.new_items += rows.filter((r) => !existing.has(r.cmid)).length;
  if (rows.length > 0) {
    const { error } = await db.from('learnweb_items').upsert(rows, { onConflict: 'cmid' });
    if (error) throw new Error(`Items upsert: ${error.message}`);
  }
  // Verschwundene Items dieses Kurses soft-deleten.
  const fresh = new Set(items.map((i) => i.cmid));
  const { data: live } = await db
    .from('learnweb_items')
    .select('id, cmid')
    .eq('course_id', dbCourseId)
    .is('deleted_at', null);
  for (const it of live ?? []) {
    if (!fresh.has(it.cmid)) await db.from('learnweb_items').update({ deleted_at: nowIso }).eq('id', it.id);
  }
}

async function syncAnnouncements(
  db: Db,
  session: Session,
  dbCourseId: string,
  forumCmid: number,
  report: LearnwebSyncReport,
): Promise<void> {
  const html = await session.get$((s) => lwGet(s, `mod/forum/view.php?id=${forumCmid}`));
  const discussions = parseForumDiscussionList(html);
  const existing = new Set(
    (await db.from('learnweb_announcements').select('discussion_id').eq('course_id', dbCourseId)).data?.map(
      (r) => r.discussion_id,
    ) ?? [],
  );

  for (const d of discussions) {
    if (existing.has(d.discussionId)) {
      // Nur Betreff/pinned aktualisieren; Body wird nicht erneut geladen (Ankündigungen sind quasi unveränderlich).
      await db
        .from('learnweb_announcements')
        .update({ subject: d.subject, pinned: d.pinned, deleted_at: null })
        .eq('discussion_id', d.discussionId);
      continue;
    }
    const postHtml = await session.get$((s) => lwGet(s, `mod/forum/discuss.php?d=${d.discussionId}`));
    const posts = parseDiscussionPage(postHtml);
    const first = posts[0];
    const { error } = await db.from('learnweb_announcements').insert({
      course_id: dbCourseId,
      discussion_id: d.discussionId,
      subject: first?.subject || d.subject,
      author: first?.author ?? null,
      posted_at: first?.postedAt ?? null,
      body_text: first?.bodyText ?? '',
      url: d.url,
      pinned: d.pinned,
    });
    if (error) {
      report.warnings.push(`Ankündigung d=${d.discussionId}: ${error.message}`);
    } else {
      report.new_announcements++;
    }
  }
}

async function syncOpencast(
  db: Db,
  session: Session,
  dbCourseId: string,
  cmid: number,
  itemId: string | null,
  report: LearnwebSyncReport,
): Promise<void> {
  const listHtml = await session.get$((s) => lwGet(s, `mod/opencast/view.php?id=${cmid}`));
  const episodes = parseOpencastList(listHtml);
  const rows = episodes.map((ep) => ({
    course_id: dbCourseId,
    item_id: itemId,
    episode_key: ep.episodeId,
    kind: 'opencast' as const,
    title: ep.title,
    duration_seconds: ep.durationSeconds,
    recorded_at: ep.recordedAt,
    episode_url: ep.url,
    preview_url: ep.previewUrl,
    deleted_at: null,
  }));
  const existing = new Set(
    (await db.from('learnweb_videos').select('episode_key').eq('course_id', dbCourseId)).data?.map(
      (r) => r.episode_key,
    ) ?? [],
  );
  report.new_videos += rows.filter((r) => !existing.has(r.episode_key)).length;
  if (rows.length > 0) {
    const { error } = await db.from('learnweb_videos').upsert(rows, { onConflict: 'episode_key' });
    if (error) throw new Error(`Videos upsert: ${error.message}`);
  }
}

/** Ankündigungs-Forum finden (Name matcht Ankündigung/Announcement; sonst erstes Forum). */
function pickAnnouncementForum(items: ParsedItem[]): ParsedItem | null {
  const forums = items.filter((i) => i.modtype === 'forum');
  return (
    forums.find((f) => /ank[üu]ndigung|announcement|nachrichten|news/i.test(f.name)) ?? forums[0] ?? null
  );
}

async function cmidToItemId(db: Db, dbCourseId: string): Promise<Map<number, string>> {
  const { data } = await db.from('learnweb_items').select('id, cmid').eq('course_id', dbCourseId);
  return new Map((data ?? []).map((r) => [r.cmid, r.id]));
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
