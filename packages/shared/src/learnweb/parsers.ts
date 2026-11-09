// Learnweb-HTML-Parser (Moodle 4.x). Reine Funktionen HTML -> Daten, kein fetch,
// kein Zugriff auf process.env. Primärselektoren mit Fallbacks gegen Markup-Drift;
// bei unerwartetem Markup wird LearnwebParseError geworfen (Meldung nennt Kontext,
// nie den HTML-Body). Verifiziert gegen echte Learnweb-Seiten.

import * as cheerio from 'cheerio';
import { LearnwebParseError } from './client.js';

export interface ParsedItem {
  cmid: number;
  name: string;
  /** Moodle-Modultyp: resource, folder, forum, url, opencast, scheduler, … */
  modtype: string;
  /** Anzeige-Label der Seite („Datei", „Verzeichnis"), aus dem accesshide-Text. */
  typeLabel: string;
  url: string;
  sizeText: string | null;
  sectionId: number | null;
  sectionName: string;
  subsectionName: string | null;
  sortOrder: number;
}

export interface ParsedCourse {
  title: string;
  items: ParsedItem[];
}

export interface ParsedEpisode {
  episodeId: string;
  title: string;
  durationText: string | null;
  durationSeconds: number | null;
  dateText: string | null;
  recordedAt: string | null; // ISO date (YYYY-MM-DD)
  url: string;
  previewUrl: string | null;
}

export interface ParsedDiscussion {
  discussionId: number;
  subject: string;
  url: string;
  pinned: boolean;
}

export interface ParsedPost {
  author: string | null;
  postedAt: string | null; // ISO datetime
  subject: string;
  bodyText: string; // Plaintext/Markdown-Extrakt (Links als [text](href))
}

export interface EpisodeData {
  metadata: { id: string; title: string; duration: number; preview: string | null };
  streams: Array<{
    sources: { mp4?: Array<{ src: string; res?: { w: number; h: number } }> };
    content: string; // 'presentation' | 'presenter'
    role?: string; // 'mainAudio' | …
  }>;
}

export interface Mp4Pick {
  src: string;
  width: number | null;
  height: number | null;
}

const ABS = (href: string): string =>
  href.startsWith('http') ? href : `https://sso.uni-muenster.de/LearnWeb/learnweb2/${href.replace(/^\//, '')}`;

/** „1:50:00" oder „50:00" -> Sekunden. */
export function parseDurationText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.trim().match(/^(\d+):(\d{2}):(\d{2})$/) || text.trim().match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

/** „06.07.26" (DD.MM.YY) bzw. „06.07.2026" -> ISO-Datum (YYYY-MM-DD) oder null. */
export function parseGermanShortDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.trim().match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${month}-${day}`;
}

/** Erste Größenangabe („1,2 MB") aus einem Text ziehen. */
function extractSize(text: string): string | null {
  const m = text.match(/(\d+([.,]\d+)?)\s?(bytes|KB|MB|GB)/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Kursseite -> Aktivitätenliste (Sektionen flach, Subsektion als Zusatzfeld).
 * Wirft, wenn eine offensichtlich echte Kursseite keine Aktivitäten liefert.
 */
export function parseCoursePage(html: string): ParsedCourse {
  const $ = cheerio.load(html);
  const title = ($('title').first().text() || '').replace(/\s*\|\s*Learnweb\s*$/i, '').replace(/^Kurs:\s*/i, '').trim();

  const items: ParsedItem[] = [];
  let order = 0;
  const pushActivity = ($a: cheerio.Cheerio<any>, modtypeHint?: string): void => {
    const cls = $a.attr('class') || '';
    if (/modtype_subsection/.test(cls)) return; // Subsektions-Header sind keine Materialien
    const modtype = modtypeHint || (cls.match(/modtype_(\w+)/) || [])[1];
    if (!modtype) return;

    const link = $a
      .find('a[href]')
      .filter((_, a) => /\/mod\/[a-z]+\/view\.php|\/mod\/[a-z]+\/index\.php/.test($(a).attr('href') || ''))
      .first();
    const href = link.attr('href');
    const cmidAttr = $a.attr('data-id');
    const cmid = cmidAttr ? Number(cmidAttr) : Number((href?.match(/[?&]id=(\d+)/) || [])[1]);
    if (!cmid || Number.isNaN(cmid)) return;

    // Name = instancename ohne die screenreader-.accesshide (das Typ-Label).
    const $inst = $a.find('.instancename').first();
    const typeLabel = $inst.find('.accesshide').first().text().trim();
    const name =
      $inst.clone().find('.accesshide').remove().end().text().trim().replace(/\s+/g, ' ') ||
      link.text().trim().replace(/\s+/g, ' ');
    if (!name) return;

    // Sektions-Kette (äußerste -> innerste). Erste = Sektion, letzte (falls >1) = Subsektion.
    const secEls = $a.parents('li.section').toArray().reverse();
    const secNames = secEls.map((s) =>
      $(s).find('.sectionname').first().text().trim().replace(/\s+/g, ' '),
    );
    const sectionName = secNames[0] || '';
    const subsectionName = secNames.length > 1 ? secNames[secNames.length - 1] : null;
    const sectionId = secEls[0] ? Number($(secEls[0]).attr('data-id')) || null : null;

    items.push({
      cmid,
      name,
      modtype,
      typeLabel,
      url: href ? ABS(href) : '',
      sizeText: extractSize($a.text()),
      sectionId,
      sectionName,
      subsectionName,
      sortOrder: order++,
    });
  };

  const activities = $('li.activity');
  if (activities.length > 0) {
    activities.each((_, el) => pushActivity($(el)));
  } else {
    // Fallback bei Markup-Drift: alle mod/*/view.php-Links, nach nächster Überschrift gruppieren.
    $('a[href]')
      .filter((_, a) => /\/mod\/[a-z]+\/view\.php\?id=\d+/.test($(a).attr('href') || ''))
      .each((_, a) => {
        const $a = $(a);
        const href = $a.attr('href') || '';
        const cmid = Number((href.match(/[?&]id=(\d+)/) || [])[1]);
        const modtype = (href.match(/\/mod\/([a-z]+)\//) || [])[1];
        if (!cmid || !modtype) return;
        const sectionName = $a.closest('li.section, section').find('.sectionname, h3').first().text().trim().replace(/\s+/g, ' ');
        items.push({
          cmid, name: $a.text().trim().replace(/\s+/g, ' ') || `Aktivität ${cmid}`,
          modtype, typeLabel: '', url: ABS(href), sizeText: null,
          sectionId: null, sectionName, subsectionName: null, sortOrder: order++,
        });
      });
  }

  if (items.length === 0 && $('#region-main, [role="main"]').length > 0 && /course\/view\.php|section/.test(html)) {
    // Eine echte Kursseite ohne erkannte Aktivitäten deutet auf Markup-Änderung.
    if ($('li.section').length > 0) {
      throw new LearnwebParseError('Kursseite: keine Aktivitäten erkannt (Markup geändert?).');
    }
  }
  return { title, items };
}

/** Opencast-Übersicht -> Episodenliste. */
export function parseOpencastList(html: string): ParsedEpisode[] {
  const $ = cheerio.load(html);
  const episodes: ParsedEpisode[] = [];
  const seen = new Set<string>();

  $('a[href*="&e="], a[href*="?e="]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const m = href.match(/[?&]e=([0-9a-fA-F-]{36})/);
    if (!m) return;
    const episodeId = m[1];
    if (seen.has(episodeId)) return;
    seen.add(episodeId);

    const $item = $a.closest('li.episode, li, article');
    const title =
      $item.find('.title').first().text().trim() ||
      $a.find('img').attr('alt')?.trim() ||
      $a.text().replace(/\d+:\d{2}(:\d{2})?/, '').replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/, '').trim();
    const durationText = $item.find('.duration').first().text().trim() || (($a.text().match(/\d+:\d{2}:\d{2}/) || [])[0] ?? null);
    const dateText = $item.find('.date').first().text().trim() || (($a.text().match(/\d{1,2}\.\d{1,2}\.\d{2,4}/) || [])[0] ?? null);
    const previewUrl = $item.find('.thumbnail img, img').first().attr('src') || null;

    episodes.push({
      episodeId,
      title: title || `Episode ${episodeId.slice(0, 8)}`,
      durationText: durationText || null,
      durationSeconds: parseDurationText(durationText),
      dateText: dateText || null,
      recordedAt: parseGermanShortDate(dateText),
      url: ABS(href),
      previewUrl,
    });
  });
  return episodes;
}

/** Forums-Übersicht -> Diskussionsliste (nur Id + Betreff + pinned; Rest von der Diskussionsseite). */
export function parseForumDiscussionList(html: string): ParsedDiscussion[] {
  const $ = cheerio.load(html);
  const out: ParsedDiscussion[] = [];
  const seen = new Set<number>();

  const consider = ($link: cheerio.Cheerio<any>, $row: cheerio.Cheerio<any>): void => {
    const href = $link.attr('href') || '';
    const m = href.match(/discuss\.php\?d=(\d+)/);
    if (!m) return;
    const discussionId = Number(m[1]);
    if (seen.has(discussionId)) return;
    seen.add(discussionId);
    const subject = $link.text().trim().replace(/\s+/g, ' ') || `Diskussion ${discussionId}`;
    const pinned =
      $row.hasClass('pinned') ||
      $row.find('.pinned, [data-pinned="true"], .fa-map-pin, .fa-thumbtack, .icon.fa-thumb-tack').length > 0;
    out.push({ discussionId, subject, url: ABS(href), pinned });
  };

  const rows = $('tr[data-region="discussion-list-item"], tr.discussion');
  if (rows.length > 0) {
    rows.each((_, row) => {
      const $row = $(row);
      consider($row.find('a[href*="discuss.php?d="]').first(), $row);
    });
  } else {
    $('a[href*="discuss.php?d="]').each((_, a) => consider($(a), $(a).closest('tr, li, div')));
  }
  return out;
}

/** Diskussionsseite -> Beiträge (der erste ist die Ankündigung). */
export function parseDiscussionPage(html: string): ParsedPost[] {
  const $ = cheerio.load(html);
  const posts: ParsedPost[] = [];

  $('.forumpost, [data-region="post"], article.forum-post').each((_, el) => {
    const $p = $(el);
    const author =
      $p.find('a[href*="/user/view.php"]').first().text().trim() ||
      $p.find('[data-region="post-author"], .author').first().text().trim() ||
      null;
    const postedAt =
      $p.find('time[datetime]').first().attr('datetime') ||
      null;
    const subject =
      $p.find('[data-region-content="forum-post-core-subject"], h3, h4, .subject').first().text().trim() || '';
    const bodyText = extractBody($, $p);
    posts.push({ author, postedAt: postedAt ? new Date(postedAt).toISOString() : null, subject, bodyText });
  });
  return posts;
}

/** Beitrags-Body als Plaintext/Markdown extrahieren (Absätze, Links erhalten). */
function extractBody($: cheerio.CheerioAPI, $post: cheerio.Cheerio<any>): string {
  const $body = $post.find('.post-content-container, .posting, [data-region="post-content"]').first();
  if ($body.length === 0) return '';
  const $c = $body.clone();
  $c.find('a[href]').each((_, a) => {
    const $a = $(a);
    const text = $a.text().trim();
    const href = $a.attr('href') || '';
    if (text && href) $a.replaceWith(`[${text}](${href})`);
  });
  $c.find('br').replaceWith('\n');
  $c.find('p, div, li').each((_, p) => {
    $(p).append('\n');
  });
  return $c
    .text()
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * `window.episode = {...}` aus der Episoden-Seite lesen. Nutzt einen
 * Klammer-Scanner (string-/escape-bewusst), weil das JSON verschachtelte
 * `}` enthält und eine einfache Regex zu wenig oder zu viel greift.
 */
export function parseEpisodeJson(html: string): EpisodeData {
  const marker = html.indexOf('window.episode');
  if (marker < 0) throw new LearnwebParseError('Episode: window.episode nicht gefunden.');
  const eq = html.indexOf('=', marker);
  const start = html.indexOf('{', eq);
  if (start < 0) throw new LearnwebParseError('Episode: kein Objekt nach window.episode.');

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new LearnwebParseError('Episode: window.episode-Objekt nicht geschlossen.');
  try {
    return JSON.parse(html.slice(start, end)) as EpisodeData;
  } catch {
    throw new LearnwebParseError('Episode: window.episode ist kein gültiges JSON.');
  }
}

/**
 * Beste mp4-Quelle wählen: bevorzugt den Haupt-Audio-Stream (role mainAudio)
 * im gewünschten content (default 'presentation') mit der größten Höhe <=
 * maxHeight. Gibt null zurück, wenn (noch) keine mp4-Quelle existiert (Opencast
 * verarbeitet evtl. noch).
 */
export function pickMp4(
  episode: EpisodeData,
  opts: { content?: string; maxHeight?: number } = {},
): Mp4Pick | null {
  const wantContent = opts.content ?? 'presentation';
  const maxHeight = opts.maxHeight ?? 480;

  const candidates: Array<Mp4Pick & { content: string; role: string; h: number }> = [];
  for (const s of episode.streams || []) {
    for (const src of s.sources?.mp4 || []) {
      candidates.push({
        src: src.src,
        width: src.res?.w ?? null,
        height: src.res?.h ?? null,
        content: s.content,
        role: s.role ?? '',
        h: src.res?.h ?? 0,
      });
    }
  }
  if (candidates.length === 0) return null;

  const score = (c: (typeof candidates)[number]): number => {
    let s = 0;
    if (c.content === wantContent) s += 1000;
    if (c.role === 'mainAudio') s += 500;
    // größte Höhe <= maxHeight bevorzugen; sonst die kleinste über dem Limit.
    s += c.h <= maxHeight ? c.h : maxHeight - c.h;
    return s;
  };
  candidates.sort((a, b) => score(b) - score(a));
  const best = candidates[0];
  return { src: best.src, width: best.width, height: best.height };
}
