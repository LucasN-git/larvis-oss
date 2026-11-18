// Datenzugriff für die Erklärvideos im Tab „Podcasts“ (Client, anon key + RLS).
import { parseChapters, parseNarrator, type ExplainerVideo, type ExplainerVideoProgress } from '@larvis/shared';
import { supabase } from '../../lib/supabase';

const BUCKET = 'explainer-video';
/** Wie bei den Folgen: gesehen wird oft mit Pausen; der Player signiert bei Ablauf neu. */
const SIGN_TTL_SECONDS = 6 * 60 * 60;

// Die schwere `search`-tsvector-Spalte bleibt draußen.
// Der Projektname kommt mit, damit Videos archivierter Projekte ihre Gruppe behalten.
const VIDEO_COLS =
  'id,slug,project_id,title,subtitle,description_md,video_path,poster_path,duration_s,chapters,narrator,sort_order,created_at,updated_at,project:projects(name)';

/** Video samt Name seines Projekts (auch eines archivierten) und signierter Vorschaubild-URL. */
export type ExplainerVideoWithProject = ExplainerVideo & { project_name: string | null; poster_url: string | null };

export interface VideoLibrary {
  videos: ExplainerVideoWithProject[];
  /** Sehstand je video_id. Ein Objekt statt Map: useLiveQuery legt das Ergebnis als JSON in den Cache. */
  progress: Record<string, ExplainerVideoProgress>;
}

/**
 * Alle abspielbaren Videos (mit Datei) samt Sehstand. Die Vorschaubilder werden in einem Zug
 * signiert; geht das schief, steht die Liste trotzdem, nur ohne Bild.
 */
export async function listExplainerVideos(): Promise<VideoLibrary> {
  const [{ data: rows, error }, { data: progressRows, error: progressError }] = await Promise.all([
    supabase
      .from('explainer_videos')
      .select(VIDEO_COLS)
      .is('deleted_at', null)
      .not('video_path', 'is', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false }),
    supabase.from('explainer_video_progress').select('video_id,position_s,completed,watched_at,updated_at'),
  ]);
  if (error) throw error;
  if (progressError) throw progressError;
  const progress: Record<string, ExplainerVideoProgress> = {};
  for (const p of progressRows ?? []) progress[p.video_id] = { ...p, position_s: Number(p.position_s) };

  const list = rows ?? [];
  const posterPaths = list.map((r) => r.poster_path).filter((p): p is string => !!p);
  const posterUrls = new Map<string, string>();
  if (posterPaths.length > 0) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(posterPaths, SIGN_TTL_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) posterUrls.set(s.path, s.signedUrl);
  }

  const videos = list.map(({ project, ...row }) => ({
    ...row,
    duration_s: row.duration_s === null ? null : Number(row.duration_s),
    chapters: parseChapters(row.chapters),
    narrator: parseNarrator(row.narrator),
    project_name: project?.name ?? null,
    poster_url: row.poster_path ? posterUrls.get(row.poster_path) ?? null : null,
  }));
  return { videos, progress };
}

/** Signierte URL für ein Video oder Vorschaubild; null, wenn der Storage sie nicht herausgibt. */
export async function signExplainerVideo(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Sehstand speichern. Ob die Liste sofort nachlädt (notifyLocalChange), entscheidet der Aufrufer. */
export async function saveExplainerVideoProgress(
  videoId: string,
  state: { position_s: number; completed: boolean },
): Promise<void> {
  const { error } = await supabase.from('explainer_video_progress').upsert(
    { video_id: videoId, ...state, watched_at: new Date().toISOString() },
    { onConflict: 'video_id' },
  );
  if (error) throw error;
}
