import { Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward } from 'lucide-react';
import { nextChapterStart, shareFileName, type PodcastEpisode, type PodcastProgress } from '@larvis/shared';
import { Button, IconButton } from '../../components/ui';
import { Loading } from '../../components/states';
import { savePodcastProgress, signPodcastAudio } from './api';
import { ChapterList, ChapterScrub, CurrentChapter } from './PlayerParts';
import { ShareButton } from './ShareButton';
import { rateLabel, usePlayback } from './usePlayback';
import './podcasts.css';

const BACK_S = 15;
const FORWARD_S = 30;

/**
 * Player einer Folge: Abspielen, 15 s zurück, 30 s vor, Kapitel vor und zurück, Tempo, eine
 * Zeitleiste mit Kapitelmarken und darunter die Kapitelliste zum Springen. Hat die Folge ein
 * Teil-Video (MP4 mit Titelkarte), lässt sie sich daneben als Video teilen. Signieren, Hörstand
 * in der Datenbank, Kapitelsprünge, Tempo und Media Session teilt er mit dem Video-Player
 * (usePlayback).
 */
export function PodcastPlayer({ episode, progress }: { episode: PodcastEpisode; progress: PodcastProgress | null }) {
  const p = usePlayback<HTMLAudioElement>({
    path: episode.audio_path,
    sign: signPodcastAudio,
    durationHint: episode.duration_s,
    chapters: episode.chapters,
    progress,
    saveProgress: (state) => savePodcastProgress(episode.id, state),
    progressTable: 'podcast_progress',
    rateKey: 'larvis.podcast-rate',
    backS: BACK_S,
    forwardS: FORWARD_S,
    metadata: { title: episode.title, artist: episode.subtitle, album: 'Larvis Podcasts' },
  });
  const chapters = episode.chapters;
  const { ready } = p;

  return (
    <div className="pod-player">
      {p.src && <audio {...p.mediaProps} />}

      <CurrentChapter chapters={chapters} current={p.current} fallback={episode.title} />
      <ChapterScrub
        t={p.t}
        duration={p.duration}
        chapters={chapters}
        disabled={!ready}
        label="Position in der Folge"
        onSeek={p.seek}
      />

      <div className="pod-controls">
        <IconButton label="Vorheriges Kapitel" variant="bare" onClick={p.prevChapter} disabled={!ready}>
          <SkipBack size={20} />
        </IconButton>
        <IconButton label={`${BACK_S} Sekunden zurück`} variant="bare" className="pod-skip" onClick={() => p.skip(-BACK_S)} disabled={!ready}>
          <RotateCcw size={24} />
          <span className="pod-skip__n">{BACK_S}</span>
        </IconButton>
        <button
          type="button"
          className="pod-play"
          onClick={p.toggle}
          disabled={!ready}
          aria-label={p.playing ? 'Pause' : 'Abspielen'}
        >
          {p.playing ? <Pause size={28} /> : <Play size={28} className="pod-play__icon" />}
        </button>
        <IconButton label={`${FORWARD_S} Sekunden vor`} variant="bare" className="pod-skip" onClick={() => p.skip(FORWARD_S)} disabled={!ready}>
          <RotateCw size={24} />
          <span className="pod-skip__n">{FORWARD_S}</span>
        </IconButton>
        <IconButton
          label="Nächstes Kapitel"
          variant="bare"
          onClick={p.nextChapter}
          disabled={!ready || nextChapterStart(chapters, p.t) === null}
        >
          <SkipForward size={20} />
        </IconButton>
      </div>
      <div className="pod-player__extra">
        <button type="button" className="chip pod-rate" onClick={p.cycleRate} aria-label={`Tempo ${rateLabel(p.rate)}, tippen zum Ändern`}>
          {rateLabel(p.rate)}
        </button>
        {episode.share_video_path && (
          <ShareButton
            path={episode.share_video_path}
            sign={signPodcastAudio}
            fileName={shareFileName(episode.subtitle || episode.title, 'Podcast')}
            title={episode.title}
          />
        )}
      </div>

      {!p.src && !p.failed && <Loading label="Audio wird geladen …" />}
      {p.failed && (
        <div className="pod-player__error" role="alert">
          <span>Die Audiodatei lässt sich gerade nicht laden.</span>
          <Button size="sm" onClick={p.retry}>
            Erneut laden
          </Button>
        </div>
      )}

      <ChapterList chapters={chapters} current={p.current} onPick={p.playFrom} />
    </div>
  );
}
