import type { ApiRequest, ApiResponse } from '../_lib/types.js';
import { admin } from '../_lib/supabaseAdmin.js';
import { verifyOwner } from '../_lib/webAuth.js';
import { learnwebEnabled } from '../_lib/modules.js';
import {
  LearnwebAuthError,
  LearnwebMaintenanceError,
  login,
  lwGet,
  parseEpisodeJson,
  type LearnwebSession,
} from '../_lib/learnweb-bundle.js';

// Löst für eine Opencast-eLecture frische mp4-URLs auf (die CDN-Links laufen ab,
// deshalb holt dieser Endpoint sie on-demand von der Episoden-Seite; der Download
// vom CDN selbst braucht keine Auth). Read-only gegenüber Learnweb: Login + ein GET.
//
// Body: { video_id: string }
// Antwort: { title, sources: [{ src, content, width, height }] } — sources absteigend
// nach Höhe, Player wählt daraus. kind='file'-Videos (mod/resource) brauchen die
// Moodle-Session des Browsers → 409 mit Hinweis, das UI öffnet dann Learnweb direkt.

// Warme Lambda: Session wiederverwenden, solange sie funktioniert (SSO-Login ist teuer).
let cachedSession: LearnwebSession | null = null;

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!learnwebEnabled()) {
    res.status(404).json({ error: 'Learnweb-Modul ist nicht eingeschaltet.' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  if (!(await verifyOwner(req))) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const { video_id: videoId } = (req.body ?? {}) as { video_id?: string };
  if (!videoId || typeof videoId !== 'string') {
    res.status(400).json({ error: 'video_id fehlt.' });
    return;
  }

  const { data: video, error } = await admin()
    .from('learnweb_videos')
    .select('id,kind,title,episode_url')
    .eq('id', videoId)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!video) {
    res.status(404).json({ error: 'Video nicht gefunden.' });
    return;
  }
  if (video.kind !== 'opencast') {
    res.status(409).json({
      error: 'Diese Aufzeichnung liegt als Moodle-Datei; sie lässt sich nur direkt in Learnweb öffnen.',
    });
    return;
  }

  try {
    let html: string;
    try {
      if (!cachedSession) cachedSession = await login();
      html = await lwGet(cachedSession, video.episode_url);
    } catch (e) {
      // Session abgelaufen → einmal frisch einloggen und erneut versuchen.
      if (!(e instanceof LearnwebAuthError)) throw e;
      cachedSession = await login();
      html = await lwGet(cachedSession, video.episode_url);
    }
    const episode = parseEpisodeJson(html);
    const sources = episode.streams
      .flatMap((s) =>
        (s.sources.mp4 ?? []).map((src) => ({
          src: src.src,
          content: s.content,
          width: src.res?.w ?? null,
          height: src.res?.h ?? null,
        })),
      )
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    if (sources.length === 0) {
      res.status(409).json({ error: 'Noch keine MP4 verfügbar (Opencast verarbeitet evtl. noch).' });
      return;
    }
    res.status(200).json({ title: video.title, sources });
  } catch (e) {
    cachedSession = null;
    if (e instanceof LearnwebAuthError || e instanceof LearnwebMaintenanceError) {
      res.status(503).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
