// Podcasts: vertonte Folgen, etwa zu einem Paper oder einer Vorlesung (Tabelle podcast_episodes,
// Hörstand in podcast_progress).
// Die Regeln, die Player, Liste und MCP gemeinsam treffen müssen, stehen hier als reine
// Funktionen: Kapitel einlesen, Kapitel zu einer Zeit finden, Zeiten formatieren, Hörstand.

export interface PodcastChapter {
  id: string;
  title: string;
  /** Sekunden in der fertigen Datei. */
  start: number;
  end: number;
}

export interface PodcastEpisode {
  id: string;
  slug: string;
  project_id: string | null;
  title: string;
  subtitle: string;
  description_md: string;
  audio_path: string | null;
  /** Dieselbe Folge als MP4 mit Titelkarte zum Verschicken; null, solange keine erzeugt ist. */
  share_video_path: string | null;
  duration_s: number | null;
  chapters: PodcastChapter[];
  voices: Record<string, { name: string; role?: string }>;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PodcastProgress {
  episode_id: string;
  position_s: number;
  completed: boolean;
  listened_at: string | null;
  updated_at: string;
}

/**
 * Ab so vielen Sekunden vor dem Ende gilt eine Folge als gehört; der Stand springt auf 0. Bei
 * sehr kurzen Folgen höchstens die letzten 5 %.
 */
export const PODCAST_END_SLACK_S = 15;
/** Wer weniger als so viele Sekunden gehört hat, hat noch nicht angefangen. */
export const PODCAST_START_SLACK_S = 5;
/** „Zurück zum Kapitelanfang“ statt „vorheriges Kapitel“, wenn man so weit im Kapitel ist. */
export const PODCAST_RESTART_CHAPTER_S = 3;

/**
 * Kapitel aus der jsonb-Spalte: nur gültige Einträge, nach Start sortiert. Was die Datenbank
 * liefert, ist ungetypt (Json); ein kaputter Eintrag soll den Player nicht umwerfen.
 */
export function parseChapters(raw: unknown): PodcastChapter[] {
  if (!Array.isArray(raw)) return [];
  const out: PodcastChapter[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const { id, title, start, end } = c as Record<string, unknown>;
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) continue;
    out.push({
      id: typeof id === 'string' && id ? id : `kapitel-${out.length + 1}`,
      title: typeof title === 'string' && title ? title : `Kapitel ${out.length + 1}`,
      start,
      end: typeof end === 'number' && Number.isFinite(end) && end > start ? end : start,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Index des Kapitels, in dem `t` liegt; -1 ohne Kapitel oder vor dem ersten Kapitel. */
export function chapterIndexAt(chapters: readonly PodcastChapter[], t: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= t + 0.05) idx = i;
  return idx;
}

/**
 * Sprungziel für „vorheriges Kapitel“: der Anfang des laufenden Kapitels, wenn man schon ein
 * paar Sekunden darin ist, sonst der Anfang des vorigen (wie bei jedem Musik-Player).
 */
export function previousChapterStart(chapters: readonly PodcastChapter[], t: number): number {
  const i = chapterIndexAt(chapters, t);
  if (i < 0) return 0;
  if (t - chapters[i].start > PODCAST_RESTART_CHAPTER_S) return chapters[i].start;
  return i === 0 ? 0 : chapters[i - 1].start;
}

/** Sprungziel für „nächstes Kapitel“ (vor dem ersten: das erste), oder null im letzten. */
export function nextChapterStart(chapters: readonly PodcastChapter[], t: number): number | null {
  const i = chapterIndexAt(chapters, t);
  return i + 1 < chapters.length ? chapters[i + 1].start : null;
}

/** 75 → „1:15“, 3725 → „1:02:05“. Negative und ungültige Werte zählen als 0. */
export function formatPodcastTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** 1819 → „30 min“, 45 → „1 min“. */
export function formatPodcastDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export type PodcastListenState =
  | { kind: 'neu' }
  | { kind: 'angefangen'; position: number; fraction: number }
  | { kind: 'gehört' };

/** Wo man in einer Folge steht, für Liste und Fortschrittsbalken. */
export function podcastListenState(
  progress: Pick<PodcastProgress, 'position_s' | 'completed'> | null | undefined,
  duration: number | null,
): PodcastListenState {
  if (progress?.completed) return { kind: 'gehört' };
  const pos = Number(progress?.position_s ?? 0);
  if (!(pos > PODCAST_START_SLACK_S)) return { kind: 'neu' };
  const fraction = duration && duration > 0 ? Math.min(1, pos / duration) : 0;
  return { kind: 'angefangen', position: pos, fraction };
}

/**
 * Welcher Hörstand gespeichert wird, wenn der Player bei `t` steht: kurz vor dem Ende gilt die
 * Folge als gehört und der nächste Start ist wieder am Anfang.
 */
export function progressAt(t: number, duration: number | null): { position_s: number; completed: boolean } {
  const pos = Number.isFinite(t) && t > 0 ? t : 0;
  if (duration && Number.isFinite(duration) && duration > 0) {
    const slack = Math.min(PODCAST_END_SLACK_S, duration * 0.05);
    if (pos >= duration - slack) return { position_s: 0, completed: true };
  }
  return { position_s: Math.round(pos * 10) / 10, completed: false };
}

/** Startpunkt beim Öffnen: der gespeicherte Stand, außer die Folge ist gehört oder neu. */
export function resumePosition(progress: Pick<PodcastProgress, 'position_s' | 'completed'> | null | undefined): number {
  if (!progress || progress.completed) return 0;
  const pos = Number(progress.position_s);
  return pos > PODCAST_START_SLACK_S ? pos : 0;
}

/**
 * Dateiname einer geteilten Folge oder eines geteilten Videos: die Kurzzeile (etwa Autoren, Jahr,
 * Journal), sonst der Titel, dahinter die Art; ohne Zeichen, die ein Dateisystem oder Messenger
 * nicht mag. „Smith & Lee 2019 · Journal of Examples“ → „Smith & Lee 2019 - Journal of Examples (Podcast).mp4“.
 */
export function shareFileName(label: string, kind: 'Podcast' | 'Video'): string {
  const cleaned = label
    .normalize('NFC')
    .replace(/\s*·\s*/g, ' - ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
  const base =
    Array.from(cleaned)
      .slice(0, 80)
      .join('')
      .replace(/^[.\s-]+|[.\s-]+$/g, '') || 'Larvis';
  return `${base} (${kind}).mp4`;
}
