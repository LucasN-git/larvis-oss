import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chapterIndexAt,
  formatPodcastDuration,
  formatPodcastTime,
  nextChapterStart,
  parseChapters,
  podcastListenState,
  previousChapterStart,
  progressAt,
  resumePosition,
  shareFileName,
} from '../src/podcasts.js';

const chapters = parseChapters([
  { id: 'b', title: 'Zwei', start: 78.073, end: 214.764 },
  { id: 'a', title: 'Eins', start: 0, end: 78.073 },
  { id: 'c', title: 'Drei', start: 214.764, end: 483.018 },
]);

// Folge mit Vorspann: das erste Kapitel beginnt nicht bei 0.
const late = parseChapters([
  { id: 'x', title: 'Eins', start: 30, end: 100 },
  { id: 'y', title: 'Zwei', start: 100, end: 200 },
]);

test('Kapitel werden nach Start sortiert, kaputte Einträge fallen weg', () => {
  assert.deepEqual(chapters.map((c) => c.id), ['a', 'b', 'c']);
  const parsed = parseChapters([null, 'x', { title: 'ohne Start' }, { start: -1 }, { start: 5, end: 2 }]);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], { id: 'kapitel-1', title: 'Kapitel 1', start: 5, end: 5 });
  assert.deepEqual(parseChapters({ not: 'an array' }), []);
});

test('Kapitel zu einer Zeit', () => {
  assert.equal(chapterIndexAt([], 10), -1);
  assert.equal(chapterIndexAt(late, 10), -1);
  assert.equal(chapterIndexAt(chapters, 0), 0);
  assert.equal(chapterIndexAt(chapters, 78.0), 0);
  // Ein Sprung genau auf den Kapitelanfang landet im neuen Kapitel, auch mit Rundung.
  assert.equal(chapterIndexAt(chapters, 78.05), 1);
  assert.equal(chapterIndexAt(chapters, 9999), 2);
});

test('vorheriges Kapitel: erst Kapitelanfang, dann das Kapitel davor', () => {
  assert.equal(previousChapterStart(chapters, 150), 78.073);
  assert.equal(previousChapterStart(chapters, 79), 0);
  assert.equal(previousChapterStart(chapters, 1), 0);
  assert.equal(previousChapterStart([], 50), 0);
});

test('vor dem ersten Kapitel: zurück an den Anfang, vor zum ersten Kapitel', () => {
  assert.equal(previousChapterStart(late, 10), 0);
  assert.equal(nextChapterStart(late, 10), 30);
  // Kurz nach dem Anfang des ersten Kapitels: zurück an den Anfang der Datei.
  assert.equal(previousChapterStart(late, 31), 0);
  assert.equal(previousChapterStart(late, 50), 30);
});

test('nächstes Kapitel, im letzten keins', () => {
  assert.equal(nextChapterStart(chapters, 10), 78.073);
  assert.equal(nextChapterStart(chapters, 300), null);
  assert.equal(nextChapterStart([], 0), null);
});

test('Zeitformat', () => {
  assert.equal(formatPodcastTime(0), '0:00');
  assert.equal(formatPodcastTime(75.9), '1:15');
  assert.equal(formatPodcastTime(3725), '1:02:05');
  assert.equal(formatPodcastTime(Number.NaN), '0:00');
  assert.equal(formatPodcastDuration(1819.27), '30 min');
  assert.equal(formatPodcastDuration(20), '1 min');
  assert.equal(formatPodcastDuration(null), '');
});

test('Hörstand: neu, angefangen, gehört', () => {
  assert.deepEqual(podcastListenState(null, 1800), { kind: 'neu' });
  assert.deepEqual(podcastListenState({ position_s: 3, completed: false }, 1800), { kind: 'neu' });
  assert.deepEqual(podcastListenState({ position_s: 900, completed: false }, 1800), {
    kind: 'angefangen',
    position: 900,
    fraction: 0.5,
  });
  assert.deepEqual(podcastListenState({ position_s: 0, completed: true }, 1800), { kind: 'gehört' });
});

test('Speichern kurz vor dem Ende markiert als gehört und setzt auf den Anfang', () => {
  assert.deepEqual(progressAt(1790, 1800), { position_s: 0, completed: true });
  assert.deepEqual(progressAt(600.04, 1800), { position_s: 600, completed: false });
  assert.deepEqual(progressAt(Number.NaN, 1800), { position_s: 0, completed: false });
  assert.deepEqual(progressAt(1790, null), { position_s: 1790, completed: false });
  // Sehr kurze Folge: nur die letzten 5 % zählen als Ende, nicht jede Stelle.
  assert.deepEqual(progressAt(5, 10), { position_s: 5, completed: false });
  assert.deepEqual(progressAt(9.6, 10), { position_s: 0, completed: true });
  assert.deepEqual(progressAt(100, Number.POSITIVE_INFINITY), { position_s: 100, completed: false });
});

test('Wiedereinstieg', () => {
  assert.equal(resumePosition(null), 0);
  assert.equal(resumePosition({ position_s: 600, completed: false }), 600);
  assert.equal(resumePosition({ position_s: 600, completed: true }), 0);
  assert.equal(resumePosition({ position_s: 2, completed: false }), 0);
});

test('shareFileName nimmt die Kurzzeile und säubert sie', () => {
  assert.equal(
    shareFileName('Smith & Lee 2019 · Journal of Examples', 'Podcast'),
    'Smith & Lee 2019 - Journal of Examples (Podcast).mp4',
  );
  assert.equal(shareFileName('a/b: c?', 'Video'), 'a b c (Video).mp4');
  assert.equal(shareFileName('   ', 'Video'), 'Larvis (Video).mp4');
  assert.equal(shareFileName('x'.repeat(200), 'Podcast').length, 80 + ' (Podcast).mp4'.length);
  // Der Schnitt bei 80 Zeichen lässt keinen Trenner am Ende stehen und halbiert kein Emoji.
  assert.equal(shareFileName('a'.repeat(77) + ' · Journal', 'Video'), `${'a'.repeat(77)} (Video).mp4`);
  assert.equal(shareFileName('a'.repeat(79) + '😀', 'Video'), `${'a'.repeat(79)}😀 (Video).mp4`);
});
