#!/usr/bin/env node
// eLecture-Transkription über die OpenAI-API (statt lokalem faster-whisper).
// Für große Batches: Audio wird mit ffmpeg extrahiert, in 15-Minuten-Opus-Chunks
// zerlegt (25-MB-API-Limit) und mit gpt-4o-mini-transcribe transkribiert
// (~0,003 $/min). Ergebnis (transcript_md + grobe 15-min-Zeitmarken) geht wie
// bei der lokalen Pipeline nach learnweb_videos.
//
// Read-only gegenüber Learnweb (Login + GET); Audio geht zu OpenAI, das
// Transkript nach Supabase.
//
// Env: root-.env.local (SUPABASE_*, LEARNWEB_*) + OPENAI_API_KEY (z. B. aus
// einer eigenen .env) + optional TRANSCRIBE_CONTEXT (Thema der Vorlesung als
// Hinweis für Whisper). Aufruf vom Repo-Root:
//   node --env-file=.env.local --env-file=.env.openai \
//     scripts/learnweb/transcribe-openai.mjs --course 12345 --missing
//   … --video <uuid>          nur dieses Video
//   … --list                  nur anzeigen, was dran wäre

import { spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, openAsBlob, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createClient } from '@supabase/supabase-js';
import {
  cookieHeader,
  login,
  lwGet,
  parseEpisodeJson,
  pickMp4,
} from '../../packages/shared/dist/learnweb/index.js';

const MEDIA_DIR = process.env.LEARNWEB_MEDIA_DIR || join(homedir(), '.cache/larvis/learnweb');
const MODEL = process.env.LEARNWEB_OPENAI_MODEL || 'gpt-4o-mini-transcribe';
const CHUNK_SECONDS = 900; // 15 min ≈ 2,7 MB Opus — weit unter dem 25-MB-Limit
const PRICE_PER_MIN = 0.003;

const args = process.argv.slice(2);
const onlyVideo = args.includes('--video') ? args[args.indexOf('--video') + 1] : null;
const courseMoodleId = args.includes('--course') ? Number(args[args.indexOf('--course') + 1]) : null;
const missing = args.includes('--missing');
const listOnly = args.includes('--list');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (--env-file=.env.local?).');
  process.exit(1);
}
if (!openaiKey && !listOnly) {
  console.error('OPENAI_API_KEY fehlt (--env-file=.env.openai?).');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const VIDEO_COLS = 'id,course_id,episode_key,kind,title,episode_url,status,duration_seconds';

// Der SSO-Apache lehnt Requests ohne Browser-User-Agent mit 401 ab.
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 Larvis-Learnweb/1.0';

// ------------------------------------------------------------ Auswahl -----

async function selectVideos() {
  let q = db.from('learnweb_videos').select(VIDEO_COLS).is('deleted_at', null);
  if (onlyVideo) {
    q = q.eq('id', onlyVideo);
  } else {
    if (courseMoodleId) {
      const { data: course, error } = await db
        .from('learnweb_courses')
        .select('id')
        .eq('moodle_id', courseMoodleId)
        .maybeSingle();
      if (error) throw error;
      if (!course) throw new Error(`Kurs ${courseMoodleId} nicht im Cache.`);
      q = q.eq('course_id', course.id);
    }
    if (missing) q = q.in('status', ['none', 'failed', 'queued']);
    else q = q.in('status', ['queued']);
  }
  const { data, error } = await q.order('sort_order').order('recorded_at');
  if (error) throw error;
  return data;
}

// ------------------------------------------------- Quelle + Audio-Chunks --

/** Frische mp4-URL (Opencast: CDN ohne Cookie; mod/resource: mit Cookie). */
async function resolveSource(session, video) {
  if (video.kind === 'file') {
    const res = await fetch(video.episode_url, {
      headers: { Cookie: cookieHeader(session), 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Resource-Redirect HTTP ${res.status}`);
    // Große mp4-Ressourcen liefern statt eines Redirects eine HTML-Einbettungsseite;
    // die echte Datei-URL (pluginfile.php/...) steht dann im Markup.
    if (res.headers.get('content-type')?.includes('text/html')) {
      const html = await res.text();
      const m = html.match(/(?:href|src)="([^"]+pluginfile[^"]+)"/);
      if (!m) throw new Error('Kein pluginfile-Link auf der Ressourcen-Seite gefunden.');
      return { mediaUrl: m[1].replace(/&amp;/g, '&'), cookie: cookieHeader(session) };
    }
    await res.body?.cancel();
    return { mediaUrl: res.url, cookie: cookieHeader(session) };
  }
  const html = await lwGet(session, video.episode_url);
  const ep = parseEpisodeJson(html);
  const pick = pickMp4(ep, { content: 'presentation', maxHeight: 480 });
  if (!pick) throw new Error('Noch keine MP4 verfügbar (Opencast verarbeitet evtl. noch).');
  return { mediaUrl: pick.src, cookie: null };
}

async function download(mediaUrl, cookie, dest) {
  const res = await fetch(mediaUrl, {
    headers: { 'User-Agent': USER_AGENT, ...(cookie ? { Cookie: cookie } : {}) },
  });
  if (!res.ok || !res.body) throw new Error(`Download HTTP ${res.status}`);
  await new Promise((ok, err) => {
    const out = createWriteStream(dest);
    Readable.fromWeb(res.body).pipe(out).on('finish', ok).on('error', err);
  });
}

/**
 * Audio als Mono-mp3 (32 kbit/s, ~3,6 MB je 15 min) in Chunks; liefert sortierte
 * Pfade. reset_timestamps ist Pflicht — sonst lehnt die OpenAI-API alle Segmente
 * nach dem ersten als "corrupted or unsupported" ab.
 */
function extractChunks(input, dir) {
  mkdirSync(dir, { recursive: true });
  const r = spawnSync(
    'ffmpeg',
    ['-nostdin', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame',
      '-b:a', '32k', '-f', 'segment', '-segment_time', String(CHUNK_SECONDS),
      '-reset_timestamps', '1', join(dir, 'chunk_%03d.mp3')],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (r.status !== 0) throw new Error('ffmpeg-Audioextraktion fehlgeschlagen.');
  return readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort().map((f) => join(dir, f));
}

/** Mediendauer in Sekunden (ffprobe), null wenn nicht bestimmbar. */
function probeDuration(input) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input],
    { encoding: 'utf8' },
  );
  const d = Number.parseFloat(r.stdout);
  return Number.isFinite(d) ? Math.round(d) : null;
}

// ------------------------------------------------------------- OpenAI ----

async function transcribeChunk(path, prevTail) {
  const prompt =
    (process.env.TRANSCRIBE_CONTEXT ? `${process.env.TRANSCRIBE_CONTEXT} ` : 'University lecture. ') +
    (prevTail ? `Previous passage ended with: ${prevTail}` : '');
  for (let attempt = 1; ; attempt++) {
    const form = new FormData();
    form.append('file', await openAsBlob(path), 'chunk.mp3');
    form.append('model', MODEL);
    form.append('prompt', prompt.slice(0, 900));
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    }).catch((e) => ({ ok: false, status: 0, _err: e }));
    if (res.ok) {
      const json = await res.json();
      return (json.text ?? '').trim();
    }
    const body = res.status ? await res.text().catch(() => '') : String(res._err);
    if (attempt >= 4 || (res.status >= 400 && res.status < 429)) {
      throw new Error(`OpenAI HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const wait = attempt * 15_000;
    console.log(`    … HTTP ${res.status}, Versuch ${attempt + 1} in ${wait / 1000}s`);
    await new Promise((ok) => setTimeout(ok, wait));
  }
}

const fmtTs = (s) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(t % 60)}` : `${m}:${p(t % 60)}`;
};

/** Fließtext in Absätze à ~5 Sätze brechen (Lesbarkeit langer Chunks). */
function paragraphs(text) {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  const out = [];
  for (let i = 0; i < sentences.length; i += 5) {
    out.push(sentences.slice(i, i + 5).join('').trim());
  }
  return out.filter(Boolean).join('\n\n');
}

// --------------------------------------------------------------- Kern ----

async function transcribeOne(session, video) {
  console.log(`\n▶ ${video.title} (${video.kind})`);
  const mediaPath = join(MEDIA_DIR, `${video.id}.media`);
  const chunkDir = join(MEDIA_DIR, `${video.id}.chunks`);
  mkdirSync(MEDIA_DIR, { recursive: true });

  await db.from('learnweb_videos').update({ status: 'transcribing', error: null }).eq('id', video.id);
  try {
    const { mediaUrl, cookie } = await resolveSource(session, video);
    console.log('  ↓ lade Medien …');
    await download(mediaUrl, cookie, mediaPath);
    const duration = probeDuration(mediaPath);

    console.log('  ♪ extrahiere Audio-Chunks …');
    const chunks = extractChunks(mediaPath, chunkDir);
    rmSync(mediaPath, { force: true });
    console.log(`  ✎ transkribiere ${chunks.length} Chunks (${MODEL}) …`);

    const segments = [];
    let prevTail = '';
    for (let i = 0; i < chunks.length; i++) {
      const text = await transcribeChunk(chunks[i], prevTail);
      const start = i * CHUNK_SECONDS;
      const end = i === chunks.length - 1 && duration ? duration : (i + 1) * CHUNK_SECONDS;
      segments.push({ start, end, text });
      prevTail = text.slice(-200);
      console.log(`    ${i + 1}/${chunks.length} ✓`);
    }

    const body = segments
      .map((s) => `**[${fmtTs(s.start)}]**\n\n${paragraphs(s.text)}`)
      .join('\n\n');
    const transcriptMd = `# ${video.title}\n\n${body}\n`;

    await db
      .from('learnweb_videos')
      .update({
        transcript_md: transcriptMd,
        segments,
        status: 'done',
        model: MODEL,
        transcribed_at: new Date().toISOString(),
        error: null,
        duration_seconds: video.duration_seconds ?? duration,
      })
      .eq('id', video.id);
    const min = (duration ?? segments.length * CHUNK_SECONDS) / 60;
    console.log(`  ✓ fertig — ${Math.round(min)} min, ~$${(min * PRICE_PER_MIN).toFixed(2)}`);
    return min * PRICE_PER_MIN;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from('learnweb_videos').update({ status: 'failed', error: msg }).eq('id', video.id);
    console.error(`  ✗ fehlgeschlagen: ${msg}`);
    return 0;
  } finally {
    rmSync(mediaPath, { force: true });
    rmSync(chunkDir, { recursive: true, force: true });
  }
}

async function main() {
  const videos = await selectVideos();
  if (listOnly) {
    console.log(`${videos.length} Video(s) im Scope:`);
    for (const v of videos) console.log(`  [${v.status}] ${v.title}`);
    return;
  }
  if (videos.length === 0) {
    console.log('Nichts zu transkribieren.');
    return;
  }
  const session = await login();
  let cost = 0;
  for (const v of videos) cost += await transcribeOne(session, v);
  console.log(`\nGesamt: ${videos.length} Video(s), geschätzt ~$${cost.toFixed(2)}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
