import { clsx } from 'clsx';
import { formatPodcastTime, type PodcastChapter } from '@larvis/shared';
import './podcasts.css';

/**
 * Zeitleiste mit Kapitelmarken und den Zeiten darunter (verstrichen, verbleibend), geteilt von
 * Podcast- und Video-Player.
 */
export function ChapterScrub({
  t,
  duration,
  chapters,
  disabled,
  label,
  onSeek,
}: {
  t: number;
  duration: number;
  chapters: readonly PodcastChapter[];
  disabled: boolean;
  label: string;
  onSeek: (to: number) => void;
}) {
  const remaining = Math.max(0, duration - t);
  const pct = duration > 0 ? Math.min(100, (t / duration) * 100) : 0;
  return (
    <>
      <div className="pod-scrub" style={{ ['--pct' as string]: `${pct}%` }}>
        <input
          type="range"
          className="pod-scrub__input"
          min={0}
          max={duration || 0}
          step={1}
          value={Math.min(t, duration || 0)}
          disabled={disabled || !duration}
          aria-label={label}
          aria-valuetext={`${formatPodcastTime(t)} von ${formatPodcastTime(duration)}`}
          onChange={(e) => onSeek(Number(e.currentTarget.value))}
        />
        <div className="pod-scrub__ticks" aria-hidden>
          {duration > 0 &&
            chapters.slice(1).map((c) => <span key={c.id} style={{ left: `${(c.start / duration) * 100}%` }} />)}
        </div>
      </div>
      <div className="pod-player__times">
        <span>{formatPodcastTime(t)}</span>
        <span>−{formatPodcastTime(remaining)}</span>
      </div>
    </>
  );
}

/** „Kapitel 2 von 5“ und der Kapiteltitel; vor dem ersten Kapitel der Titel des Ganzen. */
export function CurrentChapter({
  chapters,
  current,
  fallback,
}: {
  chapters: readonly PodcastChapter[];
  current: number;
  fallback: string;
}) {
  return (
    <div className="pod-player__chapter">
      {current >= 0 ? (
        <>
          <span className="pod-player__chapter-no">
            Kapitel {current + 1} von {chapters.length}
          </span>
          <span className="pod-player__chapter-title">{chapters[current].title}</span>
        </>
      ) : (
        <span className="pod-player__chapter-title">{fallback}</span>
      )}
    </div>
  );
}

/** Kapitelliste zum Anspringen; das laufende Kapitel ist hervorgehoben. */
export function ChapterList({
  chapters,
  current,
  onPick,
  className,
}: {
  chapters: readonly PodcastChapter[];
  current: number;
  onPick: (start: number) => void;
  className?: string;
}) {
  if (chapters.length === 0) return null;
  return (
    <section className={clsx('pod-chapters', className)}>
      <div className="section-title">Kapitel</div>
      <div className="group">
        {chapters.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={clsx('item-row pod-chapter', i === current && 'pod-chapter--current')}
            aria-current={i === current ? 'true' : undefined}
            onClick={() => onPick(c.start)}
          >
            <span className="pod-chapter__time">{formatPodcastTime(c.start)}</span>
            <span className="pod-chapter__title">{c.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
