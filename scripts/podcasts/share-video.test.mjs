// node --test scripts/podcasts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardHtml, cardSegments, voicesLine } from './share-video.mjs';

const ch = (start) => ({ title: `K${start}`, start });

test('cardSegments: eine Karte je Kapitel, die letzte bis zum Ende der Tonspur', () => {
  assert.deepEqual(cardSegments([ch(0), ch(60), ch(200)], 300), [
    { chapter: 0, start: 0, duration: 60 },
    { chapter: 1, start: 60, duration: 140 },
    { chapter: 2, start: 200, duration: 100 },
  ]);
});

test('cardSegments: Intro-Karte nur, wenn das erste Kapitel spürbar später beginnt', () => {
  assert.deepEqual(cardSegments([ch(10), ch(50)], 100)[0], { chapter: -1, start: 0, duration: 10 });
  // 0,3 s Vorlauf zählt zum ersten Kapitel, sonst blitzt eine Karte auf.
  assert.deepEqual(cardSegments([ch(0.3), ch(50)], 100)[0], { chapter: 0, start: 0, duration: 50 });
});

test('cardSegments: ohne Kapitel eine Karte über die ganze Länge', () => {
  assert.deepEqual(cardSegments([], 90), [{ chapter: -1, start: 0, duration: 90 }]);
});

test('cardSegments: Kapitel hinter dem Ende fallen weg, Reihenfolge nach Start', () => {
  const segs = cardSegments([ch(50), ch(0), ch(500)], 100);
  assert.deepEqual(
    segs.map((s) => s.chapter),
    [1, 0],
  );
  assert.equal(segs.at(-1).start + segs.at(-1).duration, 100);
});

test('cardSegments: ohne Länge ist das ein Fehler', () => {
  assert.throws(() => cardSegments([ch(0)], 0));
  assert.throws(() => cardSegments([ch(0)], Number.NaN));
});

test('voicesLine', () => {
  assert.equal(voicesLine({}), '');
  assert.equal(voicesLine({ A: { name: 'Ada' } }), 'with Ada');
  assert.equal(voicesLine({ A: { name: 'Ada' }, B: { name: 'Ben' } }), 'with Ada & Ben');
  assert.equal(voicesLine({ A: { name: 'A' }, B: { name: 'B' }, C: { name: 'C' } }), 'with A, B & C');
});

test('cardHtml maskiert Titel und Kapitel', () => {
  const html = cardHtml({
    title: '<script>x</script> & Co',
    subtitle: 'A "B"',
    voices: {},
    chapters: [{ title: '<b>Kap</b>', start: 0 }],
    durationS: 10,
    current: 0,
  });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt; &amp; Co'));
  assert.ok(html.includes('&lt;b&gt;Kap&lt;/b&gt;'));
  assert.ok(html.includes('Chapter 1 of 1'));
});

test('cardHtml: Leiste und Zähler beim mittleren von drei Kapiteln', () => {
  const html = cardHtml({
    title: 'T',
    subtitle: '',
    voices: {},
    chapters: [ch(0), ch(10), ch(20)],
    durationS: 30,
    current: 1,
  });
  assert.ok(html.includes('Chapter 2 of 3'));
  const count = (cls) => html.split(`class="seg ${cls}"`).length - 1;
  assert.equal(count('seg--done'), 1);
  assert.equal(count('seg--now'), 1);
  assert.equal(count('seg--next'), 1);
});
