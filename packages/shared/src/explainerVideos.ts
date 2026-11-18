// Erklärvideos: fertige Videos, etwa zu einem Paper oder einer Vorlesung (Tabelle
// explainer_videos, Sehstand in explainer_video_progress). Sie stehen im Tab „Podcasts“ neben
// den Folgen; die Regeln für Kapitel, Zeiten und Fortschritt sind dieselben wie dort
// (podcasts.ts). Hier steht, was nur die Videos brauchen: die Typen, der Erzähler und das
// Einordnen neben die Folgen.

import type { PodcastChapter, PodcastEpisode } from './podcasts.js';

export interface ExplainerVideo {
  id: string;
  /** Derselbe Slug wie die Podcast-Folge zum selben Thema, falls es eine gibt. */
  slug: string;
  project_id: string | null;
  title: string;
  subtitle: string;
  description_md: string;
  video_path: string | null;
  poster_path: string | null;
  duration_s: number | null;
  chapters: PodcastChapter[];
  narrator: { name: string } | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ExplainerVideoProgress {
  video_id: string;
  position_s: number;
  completed: boolean;
  watched_at: string | null;
  updated_at: string;
}

/** Erzähler aus der jsonb-Spalte; ohne Namen keiner. */
export function parseNarrator(raw: unknown): { name: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { name } = raw as Record<string, unknown>;
  return typeof name === 'string' && name.trim() ? { name: name.trim() } : null;
}

/** Route eines Erklärvideos: unter der Folge zum selben Thema, auch wenn es keine Folge gibt. */
export function explainerVideoPath(slug: string): string {
  return `/podcasts/${encodeURIComponent(slug)}/video`;
}

export type MediaShelfItem<A, V> = { kind: 'audio'; item: A } | { kind: 'video'; item: V };

type Shelvable = Pick<PodcastEpisode, 'slug' | 'sort_order' | 'created_at'>;

/**
 * Folgen und Videos in einer Liste: was denselben Slug hat (ein Thema), steht beieinander, die
 * Folge vor dem Video. Ein Paar sortiert nach dem kleineren sort_order und dem jüngeren
 * created_at seiner beiden Teile, sonst gilt die Reihenfolge der Podcast-Liste (sort_order
 * aufsteigend, neueste zuerst).
 */
export function mediaShelf<A extends Shelvable, V extends Shelvable>(
  audio: readonly A[],
  video: readonly V[],
): MediaShelfItem<A, V>[] {
  const bySlug = new Map<string, { audio?: A; video?: V; sort: number; created: string }>();
  const add = (slug: string, sort: number, created: string) => {
    let e = bySlug.get(slug);
    if (!e) bySlug.set(slug, (e = { sort, created }));
    e.sort = Math.min(e.sort, sort);
    if (created > e.created) e.created = created;
    return e;
  };
  for (const a of audio) add(a.slug, a.sort_order, a.created_at).audio = a;
  for (const v of video) add(v.slug, v.sort_order, v.created_at).video = v;
  const out: MediaShelfItem<A, V>[] = [];
  const entries = [...bySlug.values()].sort(
    (x, y) => x.sort - y.sort || (x.created < y.created ? 1 : x.created > y.created ? -1 : 0),
  );
  for (const e of entries) {
    if (e.audio) out.push({ kind: 'audio', item: e.audio });
    if (e.video) out.push({ kind: 'video', item: e.video });
  }
  return out;
}
