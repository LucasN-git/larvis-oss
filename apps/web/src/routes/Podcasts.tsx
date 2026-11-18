import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Headphones, MonitorPlay } from 'lucide-react';
import { explainerVideoPath, formatPodcastDuration, mediaShelf, podcastEpisodePath, projectColorMap } from '@larvis/shared';
import { listProjects } from '../lib/api';
import { useLiveQuery } from '../lib/useLive';
import { EmptyState, ListError, Loading } from '../components/states';
import { Markdown } from '../components/Markdown';
import { usePodcastLibrary, useVideoLibrary } from '../features/podcasts/usePodcasts';
import { MediaRows, type ShelfItem } from '../features/podcasts/PodcastList';
import { PodcastPlayer } from '../features/podcasts/PodcastPlayer';
import { ExplainerVideoPlayer } from '../features/podcasts/ExplainerVideoPlayer';
import type { VideoLibrary } from '../features/podcasts/videoApi';
import '../features/podcasts/podcasts.css';

/**
 * /podcasts zeigt Folgen und Erklärvideos nach Projekt, /podcasts/<slug> eine Folge mit Player,
 * /podcasts/<slug>/video das Erklärvideo zum selben Thema (gleicher Slug).
 */
export function Podcasts({ video = false }: { video?: boolean }) {
  const { slug } = useParams<{ slug?: string }>();
  if (slug && video) return <ExplainerVideoPage slug={slug} />;
  return slug ? <PodcastEpisodePage slug={slug} /> : <PodcastIndex />;
}

const EMPTY_VIDEO: VideoLibrary = { videos: [], progress: {} };

/** Folgen und Videos zusammen; steht, sobald die Videoliste einmal geantwortet hat, auch wenn sie scheiterte. */
function useMediaLibraries() {
  const audio = usePodcastLibrary();
  const video = useVideoLibrary();
  const data = audio.data && (video.data || !video.loading) ? { audio: audio.data, video: video.data ?? EMPTY_VIDEO } : null;
  return {
    data,
    loading: audio.loading || video.loading,
    error: audio.error,
    refetch: () => {
      audio.refetch();
      video.refetch();
    },
  };
}

function PodcastIndex() {
  const { data, loading, error, refetch } = useMediaLibraries();
  const { data: projects } = useLiveQuery(listProjects, ['projects'], [], 'projects');
  const colors = useMemo(() => projectColorMap(projects ?? []), [projects]);

  // Gruppen in der Reihenfolge der Projektliste; Projekte, die dort fehlen (archiviert), danach
  // nach Name; Folgen ohne Projekt am Ende. Der Name kommt mit der Folge, die Liste ordnet nur.
  // Innerhalb einer Gruppe stehen Folge und Video zum selben Thema beieinander (mediaShelf).
  const groups = useMemo(() => {
    const byProject = new Map<string, { id: string | null; name: string; items: ShelfItem[] }>();
    for (const s of mediaShelf(data?.audio.episodes ?? [], data?.video.videos ?? [])) {
      const e = s.item;
      const key = e.project_id ?? 'none';
      let g = byProject.get(key);
      if (!g) byProject.set(key, (g = { id: e.project_id, name: e.project_name ?? 'Ohne Projekt', items: [] }));
      g.items.push(s);
    }
    const order = new Map((projects ?? []).map((p, i) => [p.id, i] as const));
    const rank = (id: string | null) => (id === null ? Number.MAX_SAFE_INTEGER : order.get(id) ?? Number.MAX_SAFE_INTEGER - 1);
    return [...byProject.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  }, [data, projects]);

  return (
    <div className="page page--wide">
      <div className="page__header">
        <h1 className="page__title">Podcasts</h1>
      </div>
      {error && !data && <ListError error={error} onRetry={refetch} />}
      {!data && loading && <Loading />}
      {data && groups.length === 0 && (
        <EmptyState>
          Noch keine Folgen. Folgen und Erklärvideos entstehen außerhalb von Larvis, etwa mit dem
          Claude-Code-Plugin „explainers“, und kommen mit scripts/podcasts/upload.mjs bzw.
          scripts/videos/upload.mjs hierher (siehe README, „Podcasts und Erklärvideos“).
        </EmptyState>
      )}
      <div className="stack-section">
        {data &&
          groups.map((g) => (
            <section key={g.id ?? 'ohne-projekt'} className="stack gap-xs">
              <div className="section-title pod-project-head">
                {g.id && <span className="pod-project-head__dot" style={{ background: colors.get(g.id) ?? 'var(--accent)' }} />}
                {g.id ? <Link to={`/projects/${g.id}`}>{g.name}</Link> : <span>{g.name}</span>}
                <span style={{ fontWeight: 400 }}>({g.items.length})</span>
              </div>
              <MediaRows items={g.items} audioProgress={data.audio.progress} videoProgress={data.video.progress} />
            </section>
          ))}
      </div>
    </div>
  );
}

function PodcastEpisodePage({ slug }: { slug: string }) {
  const { data, loading, error, refetch } = usePodcastLibrary();
  const { data: videos } = useVideoLibrary();
  const episode = data?.episodes.find((e) => e.slug === slug);
  const projectId = episode?.project_id ?? null;
  const hasVideo = !!videos?.videos.some((v) => v.slug === slug);

  if (error && !data) return <div className="page page--wide"><ListError error={error} onRetry={refetch} /></div>;
  if (!data) return <div className="page page--wide">{loading && <Loading />}</div>;
  if (!episode) {
    return (
      <div className="page page--wide">
        <EmptyState action={<Link to="/podcasts" className="btn">Zu den Podcasts</Link>}>Folge nicht gefunden.</EmptyState>
      </div>
    );
  }

  const voices = Object.values(episode.voices)
    .map((v) => (v.role ? `${v.name} ${v.role}` : v.name))
    .join(' · ');

  return (
    <div className="page page--wide">
      <div className="pod-episode__head">
        <div className="pod-episode__titles">
          <h1 className="page__title">{episode.title}</h1>
          {episode.subtitle && <div className="pod-episode__sub">{episode.subtitle}</div>}
        </div>
      </div>
      <div className="meta-row pod-episode__meta">
        {projectId && episode.project_name && <Link to={`/projects/${projectId}?tab=podcasts`}>{episode.project_name}</Link>}
        {episode.duration_s ? <span>{formatPodcastDuration(episode.duration_s)}</span> : null}
        {voices && <span>{voices}</span>}
        {hasVideo && (
          <Link to={explainerVideoPath(episode.slug)} className="pod-episode__switch">
            <MonitorPlay size={14} /> Als Video ansehen
          </Link>
        )}
      </div>

      <div className="stack-section">
        {/* key: ein Wechsel der Folge baut den Player neu auf, mit eigenem Startpunkt. */}
        <PodcastPlayer key={episode.id} episode={episode} progress={data.progress[episode.id] ?? null} />
        {episode.description_md && (
          <div className="pod-episode__desc">
            <Markdown>{episode.description_md}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

function ExplainerVideoPage({ slug }: { slug: string }) {
  const { data, loading, error, refetch } = useVideoLibrary();
  const { data: podcasts } = usePodcastLibrary();
  const video = data?.videos.find((v) => v.slug === slug);
  const projectId = video?.project_id ?? null;
  const hasEpisode = !!podcasts?.episodes.some((e) => e.slug === slug);

  if (error && !data) return <div className="page page--wide"><ListError error={error} onRetry={refetch} /></div>;
  if (!data) return <div className="page page--wide">{loading && <Loading />}</div>;
  if (!video) {
    return (
      <div className="page page--wide">
        <EmptyState action={<Link to="/podcasts" className="btn">Zu den Podcasts</Link>}>Video nicht gefunden.</EmptyState>
      </div>
    );
  }

  return (
    <div className="page page--wide">
      <div className="pod-episode__head">
        <div className="pod-episode__titles">
          <h1 className="page__title">{video.title}</h1>
          {video.subtitle && <div className="pod-episode__sub">{video.subtitle}</div>}
        </div>
      </div>
      <div className="meta-row pod-episode__meta">
        {projectId && video.project_name && <Link to={`/projects/${projectId}?tab=podcasts`}>{video.project_name}</Link>}
        <span>Video</span>
        {video.duration_s ? <span>{formatPodcastDuration(video.duration_s)}</span> : null}
        {video.narrator && <span>erzählt von {video.narrator.name}</span>}
        {hasEpisode && (
          <Link to={podcastEpisodePath(video.slug)} className="pod-episode__switch">
            <Headphones size={14} /> Als Podcast hören
          </Link>
        )}
      </div>

      <div className="stack-section">
        {/* key: ein Wechsel des Videos baut den Player neu auf, mit eigenem Startpunkt. */}
        <ExplainerVideoPlayer key={video.id} video={video} progress={data.progress[video.id] ?? null} />
        {video.description_md && (
          <div className="pod-episode__desc">
            <Markdown>{video.description_md}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
