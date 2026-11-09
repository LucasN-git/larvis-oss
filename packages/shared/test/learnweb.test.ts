// Parser-Tests gegen echte Learnweb-Fixtures (ein beliebiger Kurs). Die Fixtures liegen in
// test/fixtures/learnweb/ und sind gitignored (enthalten Namen/Inhalte). Fehlt
// ein Fixture, wird der jeweilige Test übersprungen — ein frischer Clone bleibt grün.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isLoginPage,
  extractSesskey,
  parseCoursePage,
  parseOpencastList,
  parseEpisodeJson,
  pickMp4,
  parseForumDiscussionList,
  parseDiscussionPage,
  parseDurationText,
  parseGermanShortDate,
} from '../src/learnweb/index.js';

const fx = (name: string): string | null => {
  const p = fileURLToPath(new URL(`./fixtures/learnweb/${name}`, import.meta.url));
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

test('parseDurationText', () => {
  assert.equal(parseDurationText('1:50:00'), 6600);
  assert.equal(parseDurationText('50:00'), 3000);
  assert.equal(parseDurationText('quatsch'), null);
  assert.equal(parseDurationText(null), null);
});

test('parseGermanShortDate', () => {
  assert.equal(parseGermanShortDate('06.07.26'), '2026-07-06');
  assert.equal(parseGermanShortDate('16.04.2026'), '2026-04-16');
  assert.equal(parseGermanShortDate(''), null);
});

test('isLoginPage / extractSesskey', () => {
  const login = fx('login.html');
  const my = fx('my.html');
  if (login) assert.equal(isLoginPage(login), true);
  if (my) {
    assert.equal(isLoginPage(my), false);
    assert.ok(extractSesskey(my), 'sesskey aus /my/ extrahierbar');
  }
});

test('parseCoursePage: Kursmaterialien', () => {
  const html = fx('course.html');
  if (!html) return; // Fixture fehlt -> überspringen
  const { title, items } = parseCoursePage(html);
  assert.ok(title.length > 0, 'Kurstitel gefunden');
  assert.ok(items.length > 10, `erwartet >10 Items, war ${items.length}`);

  const resource = items.find((i) => i.modtype === 'resource');
  assert.ok(resource, 'Datei-Item gefunden');
  assert.ok(resource!.name.length > 0);
  assert.ok(resource!.sectionName);
  assert.match(resource!.url, new RegExp(`mod/resource/view\\.php\\?id=${resource!.cmid}`));

  const opencast = items.find((i) => i.modtype === 'opencast');
  assert.ok(opencast, 'Opencast-Aktivität gefunden');
  const forum = items.find((i) => i.modtype === 'forum');
  assert.ok(forum, 'Forum-Aktivität gefunden');
});

test('parseOpencastList: Episoden', () => {
  const html = fx('opencast-list.html');
  if (!html) return;
  const eps = parseOpencastList(html);
  assert.ok(eps.length > 5, `erwartet >5 Episoden, war ${eps.length}`);
  for (const ep of eps) {
    assert.match(ep.episodeId, /^[0-9a-f-]{36}$/, 'Episode-UUID');
    assert.ok(ep.title.length > 0);
  }
  // mindestens eine ~1:50h-Episode
  assert.ok(eps.some((e) => e.durationSeconds && e.durationSeconds > 6000));
  assert.ok(eps.some((e) => e.recordedAt && /^\d{4}-\d{2}-\d{2}$/.test(e.recordedAt)));
});

test('parseEpisodeJson + pickMp4', () => {
  const html = fx('episode.html');
  if (!html) return;
  const ep = parseEpisodeJson(html);
  assert.match(ep.metadata.id, /^[0-9a-f-]{36}$/);
  assert.ok(ep.metadata.duration > 0);
  assert.ok(ep.streams.length >= 1);

  const pick = pickMp4(ep, { content: 'presentation', maxHeight: 480 });
  assert.ok(pick, 'mp4-Quelle gewählt');
  assert.equal(pick!.height, 480);
  assert.match(pick!.src, /ele-cdn\.uni-muenster\.de\/.*\.mp4$/);
});

test('parseForumDiscussionList', () => {
  const html = fx('forum-list.html');
  if (!html) return;
  const ds = parseForumDiscussionList(html);
  assert.ok(ds.length > 0, 'Diskussionen gefunden');
  for (const d of ds) {
    assert.ok(Number.isInteger(d.discussionId));
    assert.ok(d.subject.length > 0);
    assert.match(d.url, /discuss\.php\?d=\d+/);
  }
});

test('parseDiscussionPage', () => {
  const html = fx('discussion.html');
  if (!html) return;
  const posts = parseDiscussionPage(html);
  assert.ok(posts.length >= 1, 'mind. ein Beitrag');
  const first = posts[0];
  assert.ok(first.subject.length > 0, 'Betreff vorhanden');
  assert.ok(first.bodyText.length > 20, 'Body-Text vorhanden');
  if (first.postedAt) assert.match(first.postedAt, /^\d{4}-\d{2}-\d{2}T/);
});
