#!/usr/bin/env node
// Lokale eLecture-Transkriptions-Pipeline. Arbeitet die Warteschlange ab
// (learnweb_videos.status='queued'): Medien auflösen -> ffmpeg -> faster-whisper
// (larvis-voice-venv) -> Transkript zurück nach Supabase. Keine API-Kosten.
//
// Read-only gegenüber Learnweb: nur Login + GET der Episoden-Seite (frische
// mp4-URL). Downloads sind reine GETs. Der einzige Write geht nach Supabase.
//
// Voraussetzung: `npm run build -w @larvis/shared`, ffmpeg, das larvis-voice-venv unter
// ~/.local/share/larvis-voice/.venv (Pfad überschreibbar mit LARVIS_VOICE_HOME; ein Python-venv mit
// faster-whisper, z. B. `python3 -m venv ~/.local/share/larvis-voice/.venv &&
// ~/.local/share/larvis-voice/.venv/bin/pip install faster-whisper`) und eine root-.env.local mit
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LEARNWEB_USERNAME, LEARNWEB_PASSWORD.
//
// Aufruf:
//   node --env-file=.env.local scripts/learnweb/transcribe-queue.mjs            # Queue leeren
//   node --env-file=.env.local scripts/learnweb/transcribe-queue.mjs --list     # nur anzeigen
//   node --env-file=.env.local scripts/learnweb/transcribe-queue.mjs --video <uuid>
//   node --env-file=.env.local scripts/learnweb/transcribe-queue.mjs --keep-media

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { createClient } from '@supabase/supabase-js';
import {
  cookieHeader,
  login,
  lwGet,
  parseEpisodeJson,
  pickMp4,
} from '../../packages/shared/dist/learnweb/index.js';

const REPO = resolve(import.meta.dirname, '../..');
const VOICE_HOME = process.env.LARVIS_VOICE_HOME || join(homedir(), '.local/share/larvis-voice');
const VENV_PY = join(VOICE_HOME, '.venv/bin/python');
const TRANSCRIBE_PY = join(REPO, 'scripts/learnweb/transcribe.py');
const MEDIA_DIR = process.env.LEARNWEB_MEDIA_DIR || join(homedir(), '.cache/larvis/learnweb');
const MODEL = process.env.LEARNWEB_WHISPER_MODEL || 'small';
const LANGUAGE = process.env.LEARNWEB_WHISPER_LANGUAGE || 'auto';

const args = process.argv.slice(2);
const only = args.includes('--video') ? args[args.indexOf('--video') + 1] : null;
const keepMedia = args.includes('--keep-media');
const listOnly = args.includes('--list');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (--env-file=.env.local?).');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const VIDEO_COLS = 'id,course_id,episode_key,kind,title,episode_url,status,duration_seconds';

async function listQueue() {
  const { data } = await db
    .from('learnweb_videos')
    .select(VIDEO_COLS)
    .in('status', ['queued', 'transcribing'])
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  return data ?? [];
}

/** Hängengebliebene 'transcribing'-Jobs (>6 h) zurück auf 'queued'. */
async function selfHeal() {
  const cutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
  await db
    .from('learnweb_videos')
    .update({ status: 'queued' })
    .eq('status', 'transcribing')
    .lt('updated_at', cutoff);
}

/** Ältesten queued-Job atomar claimen (Single-User -> optimistisch). */
async function claimNext() {
  let q = db.from('learnweb_videos').select(VIDEO_COLS).eq('status', 'queued').is('deleted_at', null);
  if (only) q = q.eq('id', only);
  const { data } = await q.order('created_at', { ascending: true }).limit(1);
  const v = data?.[0];
  if (!v) return null;
  const { data: claimed } = await db
    .from('learnweb_videos')
    .update({ status: 'transcribing', error: null })
    .eq('id', v.id)
    .eq('status', 'queued')
    .select(VIDEO_COLS);
  return claimed?.[0] ?? null;
}

/** Frische mp4-URL für ein Opencast-Video von der Episoden-Seite holen. */
async function resolveOpencast(session, video) {
  const html = await lwGet(session, video.episode_url);
  const ep = parseEpisodeJson(html);
  const pick = pickMp4(ep, { content: 'presentation', maxHeight: 480 });
  if (!pick) throw new Error('Noch keine MP4 verfügbar (Opencast verarbeitet evtl. noch).');
  return { mp4Url: pick.src, cookie: null };
}

/** mod/resource-Aufzeichnung: pluginfile-URL hinter dem Redirect (mit Cookie). */
async function resolveFile(session, video) {
  const res = await fetch(video.episode_url, {
    headers: { Cookie: cookieHeader(session) },
    redirect: 'follow',
  });
  return { mp4Url: res.url, cookie: cookieHeader(session) };
}

async function download(mp4Url, cookie, dest) {
  const res = await fetch(mp4Url, { headers: cookie ? { Cookie: cookie } : {} });
  if (!res.ok || !res.body) throw new Error(`Download HTTP ${res.status}`);
  await new Promise((ok, err) => {
    const out = createWriteStream(dest);
    Readable.fromWeb(res.body).pipe(out).on('finish', ok).on('error', err);
  });
}

/** Audio extrahieren: bevorzugt direkt aus der URL (ffmpeg-eigenes HTTPS). */
function extractAudio(input, wavPath) {
  const r = spawnSync(
    'ffmpeg',
    ['-nostdin', '-y', '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (r.status !== 0) throw new Error('ffmpeg-Audioextraktion fehlgeschlagen.');
}

function runWhisper(wavPath) {
  return new Promise((ok, err) => {
    const p = spawn(VENV_PY, [TRANSCRIBE_PY, '--audio', wavPath, '--model', MODEL, '--language', LANGUAGE], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', err);
    p.on('close', (code) => {
      if (code !== 0) return err(new Error(`transcribe.py exit ${code}`));
      try {
        ok(JSON.parse(out));
      } catch {
        err(new Error('transcribe.py lieferte kein JSON.'));
      }
    });
  });
}

const fmtTs = (s) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
};

/** Segmente zu Absätzen mit Zeitmarken bündeln (neuer Block bei >2 s Lücke oder ~90 s). */
function buildTranscriptMd(title, segments) {
  const blocks = [];
  let cur = null;
  for (const s of segments) {
    if (!cur || s.start - cur.end > 2 || s.start - cur.start > 90) {
      cur = { start: s.start, end: s.end, text: s.text };
      blocks.push(cur);
    } else {
      cur.text += ' ' + s.text;
      cur.end = s.end;
    }
  }
  const body = blocks.map((b) => `**[${fmtTs(b.start)}]** ${b.text.trim()}`).join('\n\n');
  return `# ${title}\n\n${body}\n`;
}

async function transcribeOne(session, video) {
  console.log(`\n▶ ${video.title} (${video.kind})`);
  mkdirSync(MEDIA_DIR, { recursive: true });
  const wavPath = join(MEDIA_DIR, `${video.id}.wav`);
  const mp4Path = join(MEDIA_DIR, `${video.id}.mp4`);

  try {
    const { mp4Url, cookie } =
      video.kind === 'file' ? await resolveFile(session, video) : await resolveOpencast(session, video);

    let audioInput = mp4Url;
    if (keepMedia || cookie) {
      // Mit Cookie (Datei) oder auf Wunsch: erst mp4 herunterladen, dann lokal extrahieren.
      console.log('  ↓ lade Medien …');
      await download(mp4Url, cookie, mp4Path);
      audioInput = mp4Path;
    }
    console.log('  ♪ extrahiere Audio …');
    extractAudio(audioInput, wavPath);

    console.log('  ✎ transkribiere (faster-whisper ' + MODEL + ') …');
    const result = await runWhisper(wavPath);
    const transcriptMd = buildTranscriptMd(video.title, result.segments);

    await db
      .from('learnweb_videos')
      .update({
        transcript_md: transcriptMd,
        segments: result.segments,
        status: 'done',
        model: `faster-whisper ${MODEL}`,
        transcribed_at: new Date().toISOString(),
        error: null,
        duration_seconds: video.duration_seconds ?? result.duration ?? null,
      })
      .eq('id', video.id);
    console.log(`  ✓ fertig — ${result.segments.length} Segmente, Sprache ${result.language}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from('learnweb_videos').update({ status: 'failed', error: msg }).eq('id', video.id);
    console.error(`  ✗ fehlgeschlagen: ${msg}`);
  } finally {
    rmSync(wavPath, { force: true });
    if (!keepMedia) rmSync(mp4Path, { force: true });
  }
}

async function main() {
  if (listOnly) {
    const q = await listQueue();
    console.log(`${q.length} Video(s) in der Queue:`);
    for (const v of q) console.log(`  [${v.status}] ${v.title}`);
    return;
  }

  await selfHeal();
  let session = null;
  let done = 0;
  for (;;) {
    const video = await claimNext();
    if (!video) break;
    if (!session) session = await login();
    await transcribeOne(session, video);
    done++;
  }
  console.log(done === 0 ? '\nNichts in der Queue.' : `\n${done} Video(s) verarbeitet.`);
}

main().catch((e) => {
  console.error('Pipeline-Fehler:', e instanceof Error ? e.message : e);
  process.exit(1);
});
