import { useState } from 'react';
import { ChevronRight, Headphones, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  explainerVideoPath,
  formatPodcastDuration,
  formatPodcastTime,
  podcastListenState,
  type ExplainerVideoProgress,
  type MediaShelfItem,
  type PodcastEpisode,
  type PodcastProgress,
} from '@larvis/shared';
import { Badge } from '../../components/ui';
import type { ExplainerVideoWithProject } from './videoApi';
import './podcasts.css';

export type ShelfItem = MediaShelfItem<PodcastEpisode, ExplainerVideoWithProject>;

/** Vorschaubild eines Videos; fehlt es oder lädt es nicht, eine Fläche mit Play-Zeichen. */
function VideoThumb({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="pod-thumb pod-thumb--video" aria-hidden>
      {url && !broken && <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} />}
      <span className="pod-thumb__play">
        <Play size={12} />
      </span>
    </span>
  );
}

/**
 * Folgen und Erklärvideos als Zeilen einer .group: links das Kennzeichen (Kopfhörer-Fläche bzw.
 * Vorschaubild), dann Titel, Kurzzeile, Art, Länge und Stand. Ein Klick öffnet die Folge unter
 * /podcasts/<slug> bzw. das Video unter /podcasts/<slug>/video.
 */
export function MediaRows({
  items,
  audioProgress,
  videoProgress,
}: {
  items: readonly ShelfItem[];
  audioProgress: Readonly<Record<string, PodcastProgress>>;
  videoProgress: Readonly<Record<string, ExplainerVideoProgress>>;
}) {
  const navigate = useNavigate();
  return (
    <div className="group pod-group">
      {items.map((s) => {
        const e = s.item;
        const isVideo = s.kind === 'video';
        const state = podcastListenState(isVideo ? videoProgress[e.id] : audioProgress[e.id], e.duration_s);
        const to = isVideo ? explainerVideoPath(e.slug) : `/podcasts/${encodeURIComponent(e.slug)}`;
        const open = () => navigate(to);
        return (
          <div
            key={`${s.kind}:${e.id}`}
            className="item-row pod-row"
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                open();
              }
            }}
          >
            {isVideo ? (
              <VideoThumb key={s.item.poster_url ?? 'none'} url={s.item.poster_url} />
            ) : (
              <span className="pod-thumb" aria-hidden>
                <Headphones size={18} />
              </span>
            )}
            <div className="item-row__main">
              <div className="item-row__title">{e.title}</div>
              {e.subtitle && <div className="item-row__sub">{e.subtitle}</div>}
              <div className="meta-row pod-row__meta">
                <span className="pod-row__kind">{isVideo ? 'Video' : 'Podcast'}</span>
                {e.duration_s ? <span>{formatPodcastDuration(e.duration_s)}</span> : null}
                {e.chapters.length > 0 && <span>{e.chapters.length} Kapitel</span>}
                {state.kind === 'neu' && <Badge tone="accent">Neu</Badge>}
                {state.kind === 'gehört' && <Badge tone="success">{isVideo ? 'Gesehen' : 'Gehört'}</Badge>}
                {state.kind === 'angefangen' && <span>bei {formatPodcastTime(state.position)}</span>}
              </div>
              {state.kind === 'angefangen' && (
                <div className="pod-row__bar" aria-hidden>
                  <span style={{ width: `${Math.round(state.fraction * 100)}%` }} />
                </div>
              )}
            </div>
            <ChevronRight size={18} style={{ color: 'var(--text-muted)' }} />
          </div>
        );
      })}
    </div>
  );
}
