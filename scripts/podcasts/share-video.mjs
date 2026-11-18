// Teil-Video einer Podcast-Folge: dieselbe Tonspur als MP4 mit einem Bild dazu, damit sich die
// Folge wie ein Video verschicken lässt (WhatsApp, AirDrop, Mail nehmen kein nacktes MP3 als
// Video an). Das Bild ist eine Titelkarte im Larvis-Look — Titel, Kurzzeile, Stimmen — und
// darunter das laufende Kapitel mit einer Leiste aus allen Kapiteln; es wechselt an jeder
// Kapitelmarke.
//
// Gerendert wird lokal auf dem eigenen Rechner, nie in Larvis: jede Karte ist eine kleine
// HTML-Seite, die Chrome headless als PNG fotografiert (nicht jedes ffmpeg-Build hat drawtext),
// ffmpeg setzt die Standbilder mit der Tonspur zu einer H.264/AAC-MP4 zusammen. Ein Standbild
// kostet kaum Bits; eine halbe Stunde wiegt so etwa so viel wie die MP3.
//
// Genutzt von scripts/podcasts/upload.mjs (neue Folgen) und scripts/podcasts/backfill-share-video.mjs
// (Folgen, die schon in Larvis liegen). Braucht ffmpeg und ffprobe im PATH und Google Chrome oder
// Chromium: unter CHROME_PATH, am Standardort (macOS /Applications) oder im PATH
// (google-chrome, google-chrome-stable, chromium, chromium-browser).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const FONT = resolve(
  HERE,
  '../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2',
);
const FONT_EXT = FONT.replace('-latin-wght', '-latin-ext-wght');
const WIDTH = 1920;
const HEIGHT = 1080;
/** Ein Intro vor dem ersten Kapitel bekommt nur dann eine eigene Karte, wenn es länger ist. */
const MIN_INTRO_S = 0.5;
/** Bilder pro Sekunde im Video. Ein Standbild braucht nicht mehr; Players spulen damit sauber. */
const FPS = 2;
/** Ab so vielen Zeichen steht der Titel kleiner und auf bis zu vier Zeilen. */
const LONG_TITLE = 90;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const CHROME_COMMANDS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const app = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (app) return app;
  for (const d of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of CHROME_COMMANDS) if (existsSync(join(d, name))) return join(d, name);
  }
  return null;
}

/**
 * Welche Karte von wann bis wann steht: ein Intro ohne Kapitel, falls das erste Kapitel später
 * beginnt, dann je Kapitel eine Karte bis zum Start des nächsten; die letzte reicht bis zum Ende
 * der Tonspur. Kapitel, die nach dem Ende beginnen oder keine Länge haben, fallen weg.
 * Rückgabe: [{ chapter: index | -1, start, duration }].
 */
export function cardSegments(chapters, durationS) {
  const total = Number(durationS);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Länge der Tonspur fehlt');
  const starts = (chapters ?? [])
    .map((c, i) => ({ i, start: Number(c.start) }))
    .filter((c) => Number.isFinite(c.start) && c.start >= 0 && c.start < total)
    .sort((a, b) => a.start - b.start);
  const segs = [];
  if (starts.length === 0 || starts[0].start > MIN_INTRO_S) {
    segs.push({ chapter: -1, start: 0, end: starts[0]?.start ?? total });
  } else {
    starts[0] = { ...starts[0], start: 0 };
  }
  starts.forEach((c, k) => segs.push({ chapter: c.i, start: c.start, end: starts[k + 1]?.start ?? total }));
  return segs
    .map((s) => ({ chapter: s.chapter, start: s.start, duration: s.end - s.start }))
    .filter((s) => s.duration > 0.01);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** „with Ada & Ben“ aus { A: { name }, B: { name } }; leer ohne Stimmen. */
export function voicesLine(voices) {
  const names = Object.values(voices ?? {})
    .map((v) => v?.name)
    .filter((n) => typeof n === 'string' && n);
  if (names.length === 0) return '';
  if (names.length === 1) return `with ${names[0]}`;
  return `with ${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
}

/** HTML einer Karte. `current` ist der Kapitelindex oder -1 für das Intro. */
export function cardHtml({ title, subtitle, voices, chapters, durationS, current }) {
  const list = chapters ?? [];
  const total = Number(durationS) || 1;
  const bar = list
    .map((c, i) => {
      const end = list[i + 1]?.start ?? total;
      const share = Math.max(0.4, ((end - c.start) / total) * 100);
      const state = current < 0 || i > current ? 'next' : i === current ? 'now' : 'done';
      return `<span class="seg seg--${state}" style="flex-grow:${share.toFixed(3)}"></span>`;
    })
    .join('');
  const chapter =
    current >= 0
      ? `<div class="ch-no">Chapter ${current + 1} of ${list.length}</div>
         <div class="ch-title">${esc(list[current].title)}</div>`
      : list.length > 0
        ? `<div class="ch-no">${list.length} chapters</div><div class="ch-title ch-title--muted">Intro</div>`
        : '';
  const voicesText = voicesLine(voices);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Jakarta'; src: url('${pathToFileURL(FONT).href}') format('woff2'); font-weight: 200 800; }
@font-face { font-family: 'Jakarta'; src: url('${pathToFileURL(FONT_EXT).href}') format('woff2'); font-weight: 200 800;
  unicode-range: U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
* { box-sizing: border-box; margin: 0; }
html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
body { background: #f3f4f6; font-family: 'Jakarta', system-ui, sans-serif; color: #111113; padding: 64px; }
.card { width: 100%; height: 100%; background: #fff; border-radius: 40px; padding: 104px 120px 96px;
  display: flex; flex-direction: column; box-shadow: 0 0 0 1px rgba(0,0,0,.06); }
.eyebrow { display: flex; align-items: center; gap: 16px; font-size: 26px; font-weight: 700; letter-spacing: .16em;
  text-transform: uppercase; color: #6b6e76; }
.dot { width: 18px; height: 18px; border-radius: 50%; background: #f05a28; }
h1 { margin-top: 44px; font-size: 76px; line-height: 1.1; font-weight: 750; letter-spacing: -.02em;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
h1.long { font-size: 60px; -webkit-line-clamp: 4; }
.sub { margin-top: 32px; font-size: 38px; font-weight: 500; color: #4b4e56; }
.voices { margin-top: 14px; font-size: 30px; color: #8a8d94; }
.foot { margin-top: auto; }
.ch-no { font-size: 28px; font-weight: 700; color: #f05a28; letter-spacing: .02em; }
.ch-title { margin-top: 14px; font-size: 50px; line-height: 1.15; font-weight: 650; letter-spacing: -.01em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ch-title--muted { color: #8a8d94; }
.bar { margin-top: 40px; display: flex; gap: 8px; height: 14px; }
.seg { flex-basis: 0; border-radius: 7px; background: #e3e4e8; }
.seg--done { background: #111113; }
.seg--now { background: #f05a28; }
</style></head><body><div class="card">
<div class="eyebrow"><span class="dot"></span>Podcast</div>
<h1${String(title ?? '').length > LONG_TITLE ? ' class="long"' : ''}>${esc(title)}</h1>
${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
${voicesText ? `<div class="voices">${esc(voicesText)}</div>` : ''}
<div class="foot">${chapter}${list.length > 0 ? `<div class="bar">${bar}</div>` : ''}</div>
</div></body></html>`;
}

/** Länge einer Mediendatei in Sekunden (ffprobe). */
export async function probeDuration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ]);
  const s = Number(stdout.trim());
  if (!Number.isFinite(s) || s <= 0) throw new Error(`ffprobe kennt die Länge von ${file} nicht`);
  return s;
}

async function screenshot(chrome, htmlFile, pngFile) {
  await run(chrome, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${HEIGHT}`,
    // Zeit für die Schrift, bevor das Bild entsteht.
    '--virtual-time-budget=3000',
    `--screenshot=${pngFile}`,
    pathToFileURL(htmlFile).href,
  ]);
  if (!existsSync(pngFile)) throw new Error(`Chrome hat ${pngFile} nicht geschrieben`);
}

/**
 * Baut das Teil-Video einer Folge nach `outFile`.
 * episode: { title, subtitle, voices, chapters: [{ title, start }] }; die Kapitelzeiten gelten in
 * Sekunden der MP3, die Länge kommt aus der Datei selbst.
 */
export async function renderShareVideo({ mp3File, episode, outFile, log = () => {} }) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Kein Chrome gefunden (CHROME_PATH setzen)');
  const durationS = await probeDuration(mp3File);
  const chapters = (Array.isArray(episode.chapters) ? episode.chapters : [])
    .filter((c) => c && typeof c === 'object' && Number(c.start) >= 0 && Number(c.start) < durationS)
    .map((c) => ({ title: String(c.title ?? ''), start: Number(c.start) }))
    .sort((a, b) => a.start - b.start);
  const segs = cardSegments(chapters, durationS);
  const work = await mkdtemp(join(tmpdir(), 'larvis-share-video-'));
  try {
    const cards = new Map();
    for (const s of segs) {
      if (cards.has(s.chapter)) continue;
      const html = join(work, `card-${s.chapter + 1}.html`);
      const png = join(work, `card-${s.chapter + 1}.png`);
      await writeFile(html, cardHtml({ ...episode, chapters, durationS, current: s.chapter }));
      await screenshot(chrome, html, png);
      cards.set(s.chapter, png);
    }
    log(`  ${cards.size} Karten gerendert`);

    // concat-Demuxer: jede Karte mit ihrer Dauer; die letzte steht noch einmal ohne Dauer da,
    // sonst ignoriert ffmpeg die letzte Dauerangabe.
    const q = (p) => `'${p.replace(/'/g, "'\\''")}'`;
    const lines = segs.flatMap((s) => [`file ${q(cards.get(s.chapter))}`, `duration ${s.duration.toFixed(3)}`]);
    lines.push(`file ${q(cards.get(segs.at(-1).chapter))}`);
    const list = join(work, 'cards.txt');
    await writeFile(list, `${lines.join('\n')}\n`);

    await run(
      'ffmpeg',
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0', '-i', list,
        '-i', mp3File,
        '-map', '0:v', '-map', '1:a',
        '-vf', `fps=${FPS},format=yuv420p`,
        '-c:v', 'libx264', '-tune', 'stillimage', '-preset', 'veryfast', '-crf', '24',
        // Alle 60 s ein Schlüsselbild: ein volles 1080p-Bild wiegt rund 80 KB, öfter kostet bei
        // einer halben Stunde Megabytes; ab dem Schlüsselbild dekodiert jeder Player 120 Standbilder
        // in Augenblicken, Spulen bleibt sofort.
        '-g', String(FPS * 60),
        // Die Quellen sind 64 kbit/s mono; mehr hebt die Qualität nicht, nur die Größe.
        '-c:a', 'aac', '-b:a', '64k',
        '-t', durationS.toFixed(3),
        '-movflags', '+faststart',
        outFile,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return { durationS, cards: cards.size };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
