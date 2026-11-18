// Datenzugriff für den Tab „Podcasts“ (Client, anon key + RLS).
import { parseChapters, type PodcastEpisode, type PodcastProgress } from '@larvis/shared';
import { supabase } from '../../lib/supabase';

const BUCKET = 'podcast-audio';
/** Eine Folge dauert eine halbe Stunde, gehört wird oft mit Pausen; der Player signiert bei Ablauf neu. */
const SIGN_TTL_SECONDS = 6 * 60 * 60;

// Die schwere `search`-tsvector-Spalte bleibt draußen.
// Der Projektname kommt mit, damit Folgen archivierter Projekte ihre Gruppe behalten.
const EPISODE_COLS =
  'id,slug,project_id,title,subtitle,description_md,audio_path,share_video_path,duration_s,chapters,voices,sort_order,created_at,updated_at,project:projects(name)';

type EpisodeRow = Omit<PodcastEpisode, 'chapters' | 'voices'> & {
  chapters: unknown;
  voices: unknown;
  project: { name: string } | null;
};

/** Folge samt Name ihres Projekts (auch eines archivierten). */
export type PodcastEpisodeWithProject = PodcastEpisode & { project_name: string | null };

/** Stimmen aus jsonb: nur Einträge mit Namen; ein kaputter Eintrag soll die Seite nicht umwerfen. */
function parseVoices(raw: unknown): PodcastEpisode['voices'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PodcastEpisode['voices'] = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const { name, role } = v as Record<string, unknown>;
    if (typeof name !== 'string' || !name) continue;
    out[k] = typeof role === 'string' && role ? { name, role } : { name };
  }
  return out;
}

function toEpisode({ project, ...row }: EpisodeRow): PodcastEpisodeWithProject {
  return {
    ...row,
    duration_s: row.duration_s === null ? null : Number(row.duration_s),
    chapters: parseChapters(row.chapters),
    voices: parseVoices(row.voices),
    project_name: project?.name ?? null,
  };
}

export interface PodcastLibrary {
  episodes: PodcastEpisodeWithProject[];
  /** Hörstand je episode_id. Ein Objekt statt Map: useLiveQuery legt das Ergebnis als JSON in den Cache. */
  progress: Record<string, PodcastProgress>;
}

/** Alle hörbaren Folgen (mit Audio) samt Hörstand; neueste zuerst innerhalb gleicher Reihenfolge. */
export async function listPodcasts(): Promise<PodcastLibrary> {
  const [{ data: rows, error }, { data: progressRows, error: progressError }] = await Promise.all([
    supabase
      .from('podcast_episodes')
      .select(EPISODE_COLS)
      .is('deleted_at', null)
      .not('audio_path', 'is', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false }),
    supabase.from('podcast_progress').select('episode_id,position_s,completed,listened_at,updated_at'),
  ]);
  if (error) throw error;
  if (progressError) throw progressError;
  const progress: Record<string, PodcastProgress> = {};
  for (const p of progressRows ?? []) progress[p.episode_id] = { ...p, position_s: Number(p.position_s) };
  return { episodes: ((rows ?? []) as unknown as EpisodeRow[]).map(toEpisode), progress };
}

/** Signierte URL für eine Folge; null, wenn der Storage sie nicht herausgibt. */
export async function signPodcastAudio(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Hörstand speichern. Ob die Liste sofort nachlädt (notifyLocalChange), entscheidet der Aufrufer. */
export async function savePodcastProgress(
  episodeId: string,
  state: { position_s: number; completed: boolean },
): Promise<void> {
  const { error } = await supabase.from('podcast_progress').upsert(
    { episode_id: episodeId, ...state, listened_at: new Date().toISOString() },
    { onConflict: 'episode_id' },
  );
  if (error) throw error;
}
