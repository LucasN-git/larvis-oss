#!/usr/bin/env node
// Eine fertige Podcast-Folge nach Larvis laden: die MP3 in den Bucket podcast-audio, die Zeile in
// podcast_episodes (upsert auf den Slug). Larvis vertont nichts selbst; die Folge entsteht
// anderswo (etwa mit dem Claude-Code-Plugin „explainers") und bringt eine episode.json mit. Das
// Paketformat steht in scripts/README.md („Paketformat der Upload-Skripte").
//
//   node --env-file=.env.local scripts/podcasts/upload.mjs <ordner> --project <slug> [--dry-run] [--no-share-video]
//
// Umgebung: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY und LARVIS_OWNER_ID (die Dateien liegen unter
// <owner_uid>/…, nur dort darf die App sie lesen). --dry-run prüft das Paket (mit gesetzter
// Umgebung auch das Projekt) und lädt nichts hoch; ohne Umgebung prüft es nur das Paket.
//
// <ordner> hält episode.mp3 und episode.json. --project nennt das Larvis-Projekt (sein Slug), dem
// die Folge gehört. Pfade im Bucket: <owner_uid>/<slug>-<hash>.mp3, jede Fassung hat einen eigenen
// Pfad (Hash des Inhalts).
//
// Zur MP3 baut das Skript das Teil-Video (MP4 mit Titelkarte und laufendem Kapitel, siehe
// share-video.mjs; braucht ffmpeg und Chrome) und lädt es als <owner_uid>/<slug>-<hash>.mp4 mit
// hoch. --no-share-video lässt es weg; bei unveränderter Tonspur bleibt das alte Teil-Video,
// sonst bietet der Player kein Teilen an, bis backfill-share-video.mjs es nachzieht.
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { renderShareVideo } from './share-video.mjs';

const BUCKET = 'podcast-audio';
// Limit des Buckets je Datei (Migration 20261118120000_podcasts_erklaervideos.sql).
const MAX_BYTES = 50 * 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY = args.includes('--dry-run');
const SHARE_VIDEO = !args.includes('--no-share-video');
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--project');
const projectSlug = opt('project');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
const exists = (p) => access(p).then(() => true, () => false);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

if (!dir || !projectSlug) fail('Aufruf: upload.mjs <ordner> --project <slug> [--dry-run] [--no-share-video]');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LARVIS_OWNER_ID } = process.env;
const HAS_ENV = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && LARVIS_OWNER_ID);
if (!HAS_ENV && !DRY) {
  fail('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY und LARVIS_OWNER_ID fehlen (node --env-file=.env.local …).');
}

const folder = resolve(dir);
if (!(await exists(join(folder, 'episode.json')))) fail(`${folder}/episode.json fehlt`);
const meta = JSON.parse(await readFile(join(folder, 'episode.json'), 'utf8'));
// Nur ein Dateiname im selben Ordner: episode.json darf auf keine andere Datei zeigen.
const mp3 = join(folder, basename(String(meta.file || 'episode.mp3')));
if (!(await exists(mp3))) fail(`${mp3} fehlt`);
const bytes = await readFile(mp3);
const size = bytes.length;

const slug = String(meta.slug || '').trim();
if (!SLUG.test(slug)) fail(`episode.json: slug fehlt oder ist ungültig (${slug || 'leer'}; erlaubt: a-z, 0-9, . _ -)`);
if (typeof meta.title !== 'string' || !meta.title.trim()) fail('episode.json: title fehlt');
if (size > MAX_BYTES) fail(`${mp3} ist ${mb(size)}, der Bucket nimmt höchstens 50 MB (kleiner kodieren)`);

const chapters = (Array.isArray(meta.chapters) ? meta.chapters : []).map((c, i) => ({
  id: String(c.id ?? `kapitel-${i + 1}`),
  title: typeof c.title === 'string' && c.title ? c.title : `Kapitel ${i + 1}`,
  start: Number(c.start),
  end: Number(c.end),
}));
if (chapters.some((c) => !Number.isFinite(c.start) || !Number.isFinite(c.end))) fail('episode.json: Kapitel ohne Zahlen bei start/end');
const voices = Object.fromEntries(
  Object.entries(meta.voices && typeof meta.voices === 'object' ? meta.voices : {})
    .filter(([, v]) => v && typeof v.name === 'string' && v.name)
    .map(([k, v]) => [k, v.role ? { name: v.name, role: String(v.role) } : { name: v.name }]),
);

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

// Jede Fassung bekommt einen eigenen Pfad (Hash des Inhalts): erst die neue Datei, dann die Zeile,
// dann die alte Datei weg. Scheitert die Zeile, bleibt die alte Folge samt Kapiteln heil.
const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
const audioPath = `${LARVIS_OWNER_ID || '<owner_uid>'}/${slug}-${hash}.mp3`;
// Das Teil-Video trägt denselben Hash: gleiche Tonspur, gleicher Pfad.
const videoTarget = audioPath.replace(/\.mp3$/, '.mp4');
const row = {
  slug,
  // Wird unten gesetzt: das alte Teil-Video bleibt nur, wenn es zur selben Tonspur gehört.
  share_video_path: null,
  project_id: project.id,
  title: meta.title.trim(),
  subtitle: typeof meta.subtitle === 'string' ? meta.subtitle : '',
  description_md: typeof meta.description === 'string' ? meta.description : '',
  audio_path: audioPath,
  duration_s: Number(meta.seconds) || null,
  chapters,
  voices,
  deleted_at: null,
};

console.log(`${slug} → Projekt ${project.name}`);
console.log(`  ${row.title}`);
console.log(`  ${mb(size)}, ${Math.round((row.duration_s || 0) / 60)} min, ${chapters.length} Kapitel`);
if (DRY) {
  console.log(`  [dry-run] würde ${BUCKET}/${audioPath} hochladen und die Zeile upserten`);
  process.exit(0);
}

const { data: before, error: beforeError } = await db
  .from('podcast_episodes')
  .select('audio_path,share_video_path')
  .eq('slug', slug)
  .maybeSingle();
if (beforeError) fail(`Bisherige Folge nicht lesbar: ${beforeError.message}`);
const oldPath = before?.audio_path ?? null;
const oldVideoPath = before?.share_video_path ?? null;
// Gleicher Pfad heißt gleicher Hash, also dieselbe Tonspur: das alte Teil-Video passt weiter.
row.share_video_path = oldVideoPath === videoTarget ? oldVideoPath : null;

const up = await db.storage.from(BUCKET).upload(audioPath, bytes, { contentType: 'audio/mpeg', upsert: true });
if (up.error) fail(`Upload: ${up.error.message}`);

const { error } = await db.from('podcast_episodes').upsert(row, { onConflict: 'slug' });
if (error) fail(`Zeile: ${error.message} (die neue Datei ${audioPath} liegt ungenutzt im Bucket)`);
console.log(`  hochgeladen: ${BUCKET}/${audioPath}`);

if (oldPath && oldPath !== audioPath) {
  const removed = await db.storage.from(BUCKET).remove([oldPath]);
  console.log(removed.error ? `  alte Datei bleibt liegen (${removed.error.message}): ${oldPath}` : `  alte Datei entfernt: ${oldPath}`);
}

// Teil-Video zur neuen Tonspur. Scheitert der Bau, steht die Folge trotzdem; bei unveränderter
// Tonspur bleibt das alte Teil-Video, sonst fehlt Teilen, bis backfill-share-video.mjs es nachholt.
if (SHARE_VIDEO) {
  const work = await mkdtemp(join(tmpdir(), 'larvis-podcast-'));
  try {
    const out = join(work, 'share.mp4');
    console.log('  Teil-Video wird gebaut …');
    await renderShareVideo({ mp3File: mp3, episode: { ...row, voices }, outFile: out, log: console.log });
    const video = await readFile(out);
    if (video.length > MAX_BYTES) throw new Error(`Teil-Video ist ${mb(video.length)}, über 50 MB`);
    const upVideo = await db.storage.from(BUCKET).upload(videoTarget, video, { contentType: 'video/mp4', upsert: true });
    if (upVideo.error) throw new Error(`Upload Teil-Video: ${upVideo.error.message}`);
    const { error: rowError } = await db.from('podcast_episodes').update({ share_video_path: videoTarget }).eq('slug', slug);
    if (rowError) throw new Error(`Zeile Teil-Video: ${rowError.message}`);
    console.log(`  Teil-Video: ${BUCKET}/${videoTarget} (${mb(video.length)})`);
  } catch (e) {
    const next = row.share_video_path
      ? `; altes Teil-Video bleibt: ${row.share_video_path}`
      : `; nachholen mit scripts/podcasts/backfill-share-video.mjs ${slug}`;
    console.error(`  Teil-Video nicht gebaut (${e.message})${next}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (oldVideoPath && oldVideoPath !== videoTarget) {
  const removed = await db.storage.from(BUCKET).remove([oldVideoPath]);
  console.log(
    removed.error ? `  altes Teil-Video bleibt liegen (${removed.error.message}): ${oldVideoPath}` : `  altes Teil-Video entfernt: ${oldVideoPath}`,
  );
}
