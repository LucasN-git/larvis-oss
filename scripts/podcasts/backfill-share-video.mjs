#!/usr/bin/env node
// Teil-Video (MP4 mit Titelkarte, siehe share-video.mjs) für Folgen nachziehen, die schon in
// Larvis liegen: holt die MP3 über eine signierte URL aus dem Bucket, baut die MP4 lokal und
// lädt sie neben die MP3 (<owner_uid>/<slug>-<hash>.mp4, derselbe Hash wie die MP3). Neue Folgen
// brauchen das nicht, upload.mjs baut das Teil-Video gleich mit.
//
//   node --env-file=.env.local scripts/podcasts/backfill-share-video.mjs [slug …] [--force] [--dry-run]
//
// Ohne Slug: alle Folgen ohne Teil-Video (etwa weil der Bau beim Upload scheiterte oder mit
// --no-share-video hochgeladen wurde). --force baut auch vorhandene neu (etwa nach einer Änderung
// an der Titelkarte). Braucht SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ffmpeg und Chrome.
import { createClient } from '@supabase/supabase-js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderShareVideo } from './share-video.mjs';

const BUCKET = 'podcast-audio';
const MAX_BYTES = 50 * 1024 * 1024;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
const slugs = args.filter((a) => !a.startsWith('--'));

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (node --env-file=.env.local …).');
  process.exit(1);
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let q = db
  .from('podcast_episodes')
  .select('id,slug,title,subtitle,voices,chapters,audio_path,share_video_path')
  .is('deleted_at', null)
  .not('audio_path', 'is', null)
  .order('created_at');
if (slugs.length > 0) q = q.in('slug', slugs);
const { data: rows, error } = await q;
if (error) {
  console.error(`Folgen nicht lesbar: ${error.message}`);
  process.exit(1);
}
const todo = (rows ?? []).filter((r) => FORCE || !r.share_video_path);
const missing = slugs.filter((s) => !(rows ?? []).some((r) => r.slug === s));
if (missing.length > 0) console.error(`Unbekannt oder ohne Audio: ${missing.join(', ')}`);
console.log(`${todo.length} Folge(n) bekommen ein Teil-Video${DRY ? ' (dry-run)' : ''}`);

let failed = 0;
for (const ep of todo) {
  console.log(`${ep.slug}: ${ep.title}`);
  if (DRY) continue;
  const work = await mkdtemp(join(tmpdir(), 'larvis-podcast-'));
  try {
    const { data: signed, error: signError } = await db.storage.from(BUCKET).createSignedUrl(ep.audio_path, 600);
    if (signError || !signed) throw new Error(`MP3 nicht signierbar: ${signError?.message ?? 'leer'}`);
    const res = await fetch(signed.signedUrl);
    if (!res.ok) throw new Error(`MP3 nicht ladbar: HTTP ${res.status}`);
    const mp3 = join(work, 'episode.mp3');
    await writeFile(mp3, Buffer.from(await res.arrayBuffer()));

    const out = join(work, 'share.mp4');
    await renderShareVideo({
      mp3File: mp3,
      episode: ep,
      outFile: out,
      log: console.log,
    });
    const video = await readFile(out);
    if (video.length > MAX_BYTES) throw new Error(`Teil-Video ist ${(video.length / 1048576).toFixed(1)} MB, über 50 MB`);

    const videoPath = ep.audio_path.replace(/\.mp3$/, '') + '.mp4';
    const up = await db.storage.from(BUCKET).upload(videoPath, video, { contentType: 'video/mp4', upsert: true });
    if (up.error) throw new Error(`Upload: ${up.error.message}`);
    const { error: rowError } = await db.from('podcast_episodes').update({ share_video_path: videoPath }).eq('id', ep.id);
    if (rowError) throw new Error(`Zeile: ${rowError.message}`);
    console.log(`  ${BUCKET}/${videoPath} (${(video.length / 1048576).toFixed(1)} MB)`);
  } catch (e) {
    failed++;
    console.error(`  fehlgeschlagen: ${e.message}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
process.exit(failed > 0 ? 1 : 0);
