import { listPodcasts } from './api';
import { listExplainerVideos } from './videoApi';
import { useLiveQuery } from '../../lib/useLive';

/** Alle Folgen samt Hörstand; Liste, Folge, Projekt-Tab und Brotkrumen teilen den Cache-Schlüssel. */
export function usePodcastLibrary() {
  return useLiveQuery(listPodcasts, ['podcast_episodes', 'podcast_progress'], [], 'podcasts');
}

/** Alle Erklärvideos samt Sehstand; geteilt wie usePodcastLibrary. */
export function useVideoLibrary() {
  return useLiveQuery(listExplainerVideos, ['explainer_videos', 'explainer_video_progress'], [], 'explainer-videos');
}
