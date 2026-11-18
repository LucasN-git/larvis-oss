#!/usr/bin/env node
// Ein fertiges Erklärvideo nach Larvis laden: MP4 und Vorschaubild in den Bucket explainer-video,
// die Zeile in explainer_videos (upsert auf den Slug). Larvis rendert nichts selbst; das Video
// entsteht anderswo (etwa mit dem Claude-Code-Plugin „explainers") und bringt eine video.json mit.
// Das Paketformat steht in scripts/README.md („Paketformat der Upload-Skripte").
//
//   node --env-file=.env.local scripts/videos/upload.mjs <ordner> --project <slug> [--dry-run]
//
// Umgebung: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY und LARVIS_OWNER_ID (die Dateien liegen unter
// <owner_uid>/…, nur dort darf die App sie lesen). --dry-run prüft das Paket (mit gesetzter
// Umgebung auch das Projekt) und lädt nichts hoch; ohne Umgebung prüft es nur das Paket.
//
// <ordner> hält video.mp4, poster.jpg (oder poster.webp) und video.json. --project nennt das
// Larvis-Projekt (sein Slug), dem das Video gehört. Pfade im Bucket: <owner_uid>/<slug>-<hash>.mp4
// und <owner_uid>/<slug>-<hash>.jpg|.webp, jede Fassung hat eigene Pfade (Hash des Inhalts).
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

const BUCKET = 'explainer-video';
// Limit des Buckets je Datei (Migration 20261118120000_podcasts_erklaervideos.sql); das Video wird
// darunter kodiert.
const MAX_BYTES = 50 * 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY = args.includes('--dry-run');
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--project');
const projectSlug = opt('project');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
const exists = (p) => access(p).then(() => true, () => false);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

if (!dir || !projectSlug) fail('Aufruf: upload.mjs <ordner> --project <slug> [--dry-run]');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LARVIS_OWNER_ID } = process.env;
const HAS_ENV = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && LARVIS_OWNER_ID);
if (!HAS_ENV && !DRY) {
  fail('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY und LARVIS_OWNER_ID fehlen (node --env-file=.env.local …).');
}

const folder = resolve(dir);
if (!(await exists(join(folder, 'video.json')))) fail(`${folder}/video.json fehlt`);
const meta = JSON.parse(await readFile(join(folder, 'video.json'), 'utf8'));
// Nur Dateinamen im selben Ordner: video.json darf auf keine andere Datei zeigen.
const mp4 = join(folder, basename(String(meta.file || 'video.mp4')));
if (!(await exists(mp4))) fail(`${mp4} fehlt`);
const bytes = await readFile(mp4);
const size = bytes.length;
let poster = null;
for (const name of meta.poster ? [basename(String(meta.poster))] : ['poster.jpg', 'poster.jpeg', 'poster.webp']) {
  if (await exists(join(folder, name))) {
    poster = join(folder, name);
    break;
  }
}
if (meta.poster && !poster) fail(`video.json: Vorschaubild ${basename(String(meta.poster))} fehlt in ${folder}`);
const posterSuffix = poster ? extname(poster).toLowerCase() : '';
if (poster && !['.jpg', '.jpeg', '.webp'].includes(posterSuffix)) fail(`${poster}: Vorschaubild muss .jpg, .jpeg oder .webp sein`);
const posterType = posterSuffix === '.webp' ? 'image/webp' : 'image/jpeg';
const posterExt = posterType === 'image/webp' ? 'webp' : 'jpg';

const slug = String(meta.slug || '').trim();
if (!SLUG.test(slug)) fail(`video.json: slug fehlt oder ist ungültig (${slug || 'leer'}; erlaubt: a-z, 0-9, . _ -)`);
if (typeof meta.title !== 'string' || !meta.title.trim()) fail('video.json: title fehlt');
if (size > MAX_BYTES) fail(`${mp4} ist ${mb(size)}, der Bucket nimmt höchstens 50 MB (Video kleiner kodieren)`);
if (bytes.subarray(4, 8).toString('latin1') !== 'ftyp') fail(`${mp4} sieht nicht nach MP4 aus (kein ftyp-Kopf)`);
const posterBytes = poster ? await readFile(poster) : null;
if (posterBytes && posterBytes.length > MAX_BYTES) fail(`${poster} ist ${mb(posterBytes.length)}, zu groß für ein Vorschaubild`);

const chapters = (Array.isArray(meta.chapters) ? meta.chapters : []).map((c, i) => ({
  id: String(c.id ?? `kapitel-${i + 1}`),
  title: typeof c.title === 'string' && c.title ? c.title : `Kapitel ${i + 1}`,
  start: Number(c.start),
  end: Number(c.end),
}));
if (chapters.some((c) => !Number.isFinite(c.start) || !Number.isFinite(c.end))) fail('video.json: Kapitel ohne Zahlen bei start/end');
const narratorName = typeof meta.narrator?.name === 'string' ? meta.narrator.name.trim() : '';
const narrator = narratorName ? { name: narratorName } : {};

// Jede Fassung bekommt eigene Pfade (Hash des Inhalts): erst die neuen Dateien, dann die Zeile,
// dann die alten Dateien weg. Scheitert die Zeile, bleibt das alte Video samt Kapiteln heil.
const owner = LARVIS_OWNER_ID || '<owner_uid>';
const hash = (b) => createHash('sha256').update(b).digest('hex').slice(0, 8);
const videoPath = `${owner}/${slug}-${hash(bytes)}.mp4`;
const posterPath = posterBytes ? `${owner}/${slug}-${hash(posterBytes)}.${posterExt}` : null;

const db = HAS_ENV ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;
let project = { id: null, name: `${projectSlug} (ungeprüft, ohne Umgebung)` };
if (db) {
  const { data, error: projectError } = await db
    .from('projects')
    .select('id,name')
    .eq('slug', projectSlug)
    .is('deleted_at', null)
    .maybeSingle();
  if (projectError) fail(`Projekt nicht lesbar: ${projectError.message}`);
  if (!data) fail(`Kein Projekt mit Slug „${projectSlug}“`);
  project = data;
}

console.log(`${slug} → Projekt ${project.name}`);
console.log(`  ${meta.title.trim()}`);
console.log(
  `  ${mb(size)}, ${Math.round((Number(meta.seconds) || 0) / 60)} min, ${chapters.length} Kapitel, ` +
    `${narratorName ? `Erzähler ${narratorName}` : 'ohne Erzähler'}, ${poster ? `Vorschaubild ${basename(poster)}` : 'ohne Vorschaubild'}`,
);
if (DRY) {
  console.log(`  [dry-run] würde ${BUCKET}/${videoPath}${posterPath ? ` und ${BUCKET}/${posterPath}` : ''} hochladen und die Zeile upserten`);
  process.exit(0);
}

const row = {
  slug,
  project_id: project.id,
  title: meta.title.trim(),
  subtitle: typeof meta.subtitle === 'string' ? meta.subtitle : '',
  description_md: typeof meta.description === 'string' ? meta.description : '',
  video_path: videoPath,
  poster_path: posterPath,
  duration_s: Number(meta.seconds) || null,
  chapters,
  narrator,
  deleted_at: null,
};

const { data: before } = await db.from('explainer_videos').select('video_path,poster_path').eq('slug', slug).maybeSingle();

const up = await db.storage.from(BUCKET).upload(videoPath, bytes, { contentType: 'video/mp4', upsert: true });
if (up.error) fail(`Upload Video: ${up.error.message}`);
if (posterBytes) {
  const upPoster = await db.storage.from(BUCKET).upload(posterPath, posterBytes, { contentType: posterType, upsert: true });
  if (upPoster.error) fail(`Upload Vorschaubild: ${upPoster.error.message} (das Video ${videoPath} liegt ungenutzt im Bucket)`);
}

const { error } = await db.from('explainer_videos').upsert(row, { onConflict: 'slug' });
if (error) fail(`Zeile: ${error.message} (die neuen Dateien liegen ungenutzt im Bucket)`);
console.log(`  hochgeladen: ${BUCKET}/${videoPath}`);
if (posterPath) console.log(`  hochgeladen: ${BUCKET}/${posterPath}`);

const stale = [before?.video_path, before?.poster_path].filter((p) => p && p !== videoPath && p !== posterPath);
if (stale.length > 0) {
  const removed = await db.storage.from(BUCKET).remove(stale);
  console.log(removed.error ? `  alte Dateien bleiben liegen (${removed.error.message}): ${stale.join(', ')}` : `  alte Dateien entfernt: ${stale.join(', ')}`);
}
