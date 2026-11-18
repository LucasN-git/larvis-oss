import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainerVideoPath, mediaShelf, parseNarrator } from '../src/explainerVideos.js';
import { progressAt, resumePosition } from '../src/podcasts.js';

const at = (slug: string, sort_order: number, created_at: string) => ({ slug, sort_order, created_at });

test('Folge und Video zum selben Thema stehen beieinander, die Folge zuerst', () => {
  const audio = [at('smith2019', 0, '2026-11-13'), at('lee2020', 0, '2026-11-10')];
  const video = [at('lee2020', 0, '2026-11-15'), at('kim2018', 0, '2026-11-12')];
  const shelf = mediaShelf(audio, video).map((s) => `${s.kind}:${s.item.slug}`);
  // lee2020 sortiert als Paar nach dem jüngeren Teil (das Video vom 15.).
  assert.deepEqual(shelf, ['audio:lee2020', 'video:lee2020', 'audio:smith2019', 'video:kim2018']);
});

test('sort_order schlägt das Datum, ein Paar nimmt den kleineren', () => {
  const audio = [at('a', 2, '2026-11-15'), at('b', 1, '2026-11-01')];
  const video = [at('a', 0, '2026-11-01')];
  assert.deepEqual(
    mediaShelf(audio, video).map((s) => `${s.kind}:${s.item.slug}`),
    ['audio:a', 'video:a', 'audio:b'],
  );
});

test('nur Videos oder nur Folgen', () => {
  assert.deepEqual(mediaShelf([], [at('x', 0, '2026-11-01')]).map((s) => s.kind), ['video']);
  assert.deepEqual(mediaShelf([at('x', 0, '2026-11-01')], []).map((s) => s.kind), ['audio']);
  assert.deepEqual(mediaShelf([], []), []);
});

test('Erzähler aus jsonb', () => {
  assert.deepEqual(parseNarrator({ name: ' Ada ' }), { name: 'Ada' });
  assert.equal(parseNarrator({}), null);
  assert.equal(parseNarrator({ name: '' }), null);
  assert.equal(parseNarrator(['Ada']), null);
  assert.equal(parseNarrator(null), null);
});

test('Route eines Videos hängt unter dem Slug', () => {
  assert.equal(explainerVideoPath('smith2019intro'), '/podcasts/smith2019intro/video');
  assert.equal(explainerVideoPath('a b'), '/podcasts/a%20b/video');
});

test('Sehstand folgt denselben Regeln wie der Hörstand', () => {
  // 13 Minuten: die letzten 15 s zählen als gesehen, der nächste Start ist vorn.
  assert.deepEqual(progressAt(770, 780), { position_s: 0, completed: true });
  assert.deepEqual(progressAt(312.34, 780), { position_s: 312.3, completed: false });
  assert.equal(resumePosition({ position_s: 312.3, completed: false }), 312.3);
});
