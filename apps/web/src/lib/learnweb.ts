import type { LearnwebSyncReport } from '@larvis/shared/learnweb';
import { supabase } from './supabase';
import { notifyLocalChange } from './useLive';

export type { LearnwebSyncReport };

/**
 * Stößt den read-only Learnweb-Sync an (serverseitige Function loggt sich ein und
 * spiegelt nach Supabase). Der Owner-Bearer der laufenden Web-Session wird
 * mitgeschickt; nach Erfolg werden die Live-Queries aller Learnweb-Tabellen
 * aufgefrischt. Wirft mit lesbarer Meldung bei 401/503/500.
 */
export async function triggerLearnwebSync(courseId?: number): Promise<LearnwebSyncReport> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch('/api/learnweb/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(courseId ? { course_id: courseId } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { report?: LearnwebSyncReport; error?: string };
  if (!res.ok) {
    throw new Error(json.error || `Sync fehlgeschlagen (${res.status})`);
  }
  notifyLocalChange(
    'learnweb_courses',
    'learnweb_items',
    'learnweb_videos',
    'learnweb_announcements',
    'learnweb_events',
  );
  if (!json.report) throw new Error('Sync ohne Report.');
  return json.report;
}

/** Eine mp4-Quelle einer Opencast-Episode (presentation = Folien, presenter = Kamera). */
export interface LearnwebVideoSource {
  src: string;
  content: string;
  width: number | null;
  height: number | null;
}

/**
 * Holt frische mp4-URLs für eine eLecture (die CDN-Links laufen ab, deshalb
 * on-demand über die serverseitige Function). Wirft mit lesbarer Meldung,
 * z. B. wenn Opencast die Aufnahme noch verarbeitet.
 */
export async function resolveLearnwebVideoSources(
  videoId: string,
): Promise<{ title: string; sources: LearnwebVideoSource[] }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch('/api/learnweb/video-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ video_id: videoId }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    title?: string;
    sources?: LearnwebVideoSource[];
    error?: string;
  };
  if (!res.ok || !json.sources?.length) {
    throw new Error(json.error || `Video-URL nicht auflösbar (${res.status})`);
  }
  return { title: json.title ?? '', sources: json.sources };
}

/** Beste Quelle für Player/Download: bevorzugt Folien-Stream, höchste Auflösung. */
export function bestVideoSource(sources: LearnwebVideoSource[]): LearnwebVideoSource {
  return sources.find((s) => s.content === 'presentation') ?? sources[0];
}

/**
 * mp4 herunterladen. Blob-Download erzwingt den Dateinamen, klappt aber nur,
 * wenn das CDN CORS erlaubt — sonst Fallback: mp4 in neuem Tab öffnen (Download
 * dann über den Browser-Player). Liefert zurück, welcher Weg es wurde.
 */
export async function downloadMp4(src: string, title: string): Promise<'saved' | 'opened'> {
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\wäöüÄÖÜß .-]+/g, '_')}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
    return 'saved';
  } catch {
    window.open(src, '_blank', 'noreferrer');
    return 'opened';
  }
}
