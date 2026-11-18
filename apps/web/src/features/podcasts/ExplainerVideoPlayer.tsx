import { useCallback, useEffect, useMemo, useState } from 'react';
import { Maximize, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, SkipBack, SkipForward } from 'lucide-react';
import { nextChapterStart, shareFileName, type ExplainerVideoProgress } from '@larvis/shared';
import { Button, IconButton } from '../../components/ui';
import { Loading } from '../../components/states';
import { useToast } from '../../lib/toast';
import {
  pictureInPictureSupported,
  togglePictureInPicture,
  type LockableOrientation,
  type PipVideoElement,
} from '../../lib/pictureInPicture';
import { saveExplainerVideoProgress, signExplainerVideo, type ExplainerVideoWithProject } from './videoApi';
import { ChapterList, ChapterScrub, CurrentChapter } from './PlayerParts';
import { ShareButton } from './ShareButton';
import { rateLabel, usePlayback } from './usePlayback';
import './podcasts.css';

const SKIP_S = 10;

/**
 * Player eines Erklärvideos: das Video mit Vorschaubild, darunter die Zeitleiste mit
 * Kapitelmarken und die Knöpfe (Kapitel zurück, 10 s zurück, Abspielen, 10 s vor, Kapitel vor,
 * Tempo, Teilen, Bild-in-Bild, Vollbild), daneben (Rechner) oder darunter (Handy, Tablet) die
 * Kapitelliste. Signieren, Sehstand in der Datenbank, Kapitelsprünge, Tempo und Media Session
 * teilt er mit dem Podcast-Player (usePlayback).
 *
 * Vollbild gilt dem Video-Element selbst und zeigt dort die Bedienelemente des Browsers; am
 * Handy dreht es nach Möglichkeit ins Querformat (Android sperrt die Ausrichtung, iOS nimmt sein
 * eigenes Vollbild, das mit dem Gerät dreht).
 */
export function ExplainerVideoPlayer({
  video,
  progress,
}: {
  video: ExplainerVideoWithProject;
  progress: ExplainerVideoProgress | null;
}) {
  const { notify } = useToast();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- neu signierte URL desselben Bilds soll die Media Session nicht neu aufbauen
  const artwork = useMemo(() => video.poster_url, [video.poster_path]);
  const p = usePlayback<PipVideoElement>({
    path: video.video_path,
    sign: signExplainerVideo,
    durationHint: video.duration_s,
    chapters: video.chapters,
    progress,
    saveProgress: (state) => saveExplainerVideoProgress(video.id, state),
    progressTable: 'explainer_video_progress',
    rateKey: 'larvis.explainer-video-rate',
    backS: SKIP_S,
    forwardS: SKIP_S,
    metadata: {
      title: video.title,
      artist: video.narrator ? `${video.subtitle} · ${video.narrator.name}` : video.subtitle,
      album: 'Larvis Erklärvideos',
      artwork,
    },
  });
  const { mediaRef, ready } = p;
  const chapters = video.chapters;
  const [fullscreen, setFullscreen] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  // Erst nach dem ersten Abspielen verschwindet die große Play-Fläche über dem Vorschaubild.
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const v = mediaRef.current;
    if (v) setPipSupported(pictureInPictureSupported(v));
  }, [mediaRef]);

  useEffect(() => {
    const onChange = () => {
      const fs = document.fullscreenElement === mediaRef.current && !!mediaRef.current;
      setFullscreen(fs);
      const o: LockableOrientation | undefined = screen.orientation;
      if (!document.fullscreenElement) o?.unlock?.();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [mediaRef]);

  const toggleFullscreen = useCallback(async () => {
    const v = mediaRef.current;
    if (!v) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    // Das iPhone meldet kein Element-Vollbild (fullscreenEnabled false) und nimmt gleich seinen
    // eigenen Weg, solange die Geste des Klicks noch gilt.
    if (document.fullscreenEnabled && typeof v.requestFullscreen === 'function') {
      try {
        await v.requestFullscreen();
        // Android: Querformat sperren. Desktop und Browser ohne Sperre: Vollbild reicht.
        const o: LockableOrientation | undefined = screen.orientation;
        await o?.lock?.('landscape').catch(() => undefined);
        return;
      } catch {
        /* weiter mit dem iOS-Weg */
      }
    }
    // iPhone: nur das Video-Element kann ins Vollbild, mit den Bedienelementen des Systems.
    if (typeof v.webkitEnterFullscreen === 'function') {
      try {
        v.webkitEnterFullscreen();
      } catch {
        notify('Video lädt noch — erst abspielen, dann Vollbild.', 'info');
      }
    } else notify('Vollbild wird von diesem Browser nicht unterstützt.', 'info');
  }, [mediaRef, notify]);

  const togglePip = useCallback(async () => {
    const v = mediaRef.current;
    if (v) await togglePictureInPicture(v, notify);
  }, [mediaRef, notify]);

  return (
    <div className="ev-layout">
      <div className="ev-main">
        <div className="ev-stage">
          <video
            {...p.mediaProps}
            className="ev-video"
            poster={video.poster_url ?? undefined}
            playsInline
            controls={fullscreen}
            onClick={() => !fullscreen && ready && p.toggle()}
            onPlay={() => {
              setStarted(true);
              p.mediaProps.onPlay();
            }}
          />
          {!started && !p.playing && (
            <button
              type="button"
              className="ev-stage__play"
              onClick={p.toggle}
              disabled={!ready}
              aria-label="Video abspielen"
            >
              <Play size={30} className="pod-play__icon" />
            </button>
          )}
        </div>

        <div className="pod-player ev-controls">
          <CurrentChapter chapters={chapters} current={p.current} fallback={video.title} />
          <ChapterScrub
            t={p.t}
            duration={p.duration}
            chapters={chapters}
            disabled={!ready}
            label="Position im Video"
            onSeek={p.seek}
          />
          <div className="ev-controls__row">
            <div className="ev-controls__main">
              <IconButton label="Vorheriges Kapitel" variant="bare" onClick={p.prevChapter} disabled={!ready}>
                <SkipBack size={20} />
              </IconButton>
              <IconButton label={`${SKIP_S} Sekunden zurück`} variant="bare" className="pod-skip" onClick={() => p.skip(-SKIP_S)} disabled={!ready}>
                <RotateCcw size={24} />
                <span className="pod-skip__n">{SKIP_S}</span>
              </IconButton>
              <button
                type="button"
                className="pod-play ev-play"
                onClick={p.toggle}
                disabled={!ready}
                aria-label={p.playing ? 'Pause' : 'Abspielen'}
              >
                {p.playing ? <Pause size={24} /> : <Play size={24} className="pod-play__icon" />}
              </button>
              <IconButton label={`${SKIP_S} Sekunden vor`} variant="bare" className="pod-skip" onClick={() => p.skip(SKIP_S)} disabled={!ready}>
                <RotateCw size={24} />
                <span className="pod-skip__n">{SKIP_S}</span>
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
            <div className="ev-controls__extra">
              <button type="button" className="chip pod-rate" onClick={p.cycleRate} aria-label={`Tempo ${rateLabel(p.rate)}, tippen zum Ändern`}>
                {rateLabel(p.rate)}
              </button>
              {video.video_path && (
                <ShareButton
                  path={video.video_path}
                  sign={signExplainerVideo}
                  fileName={shareFileName(video.subtitle || video.title, 'Video')}
                  title={video.title}
                />
              )}
              {pipSupported && (
                <IconButton label="Bild-in-Bild" variant="bare" onClick={togglePip} disabled={!ready}>
                  <PictureInPicture2 size={20} />
                </IconButton>
              )}
              <IconButton label="Vollbild" variant="bare" onClick={toggleFullscreen} disabled={!ready}>
                <Maximize size={20} />
              </IconButton>
            </div>
          </div>

          {!p.src && !p.failed && <Loading label="Video wird geladen …" />}
          {p.failed && (
            <div className="pod-player__error" role="alert">
              <span>Das Video lässt sich gerade nicht laden.</span>
              <Button size="sm" onClick={p.retry}>
                Erneut laden
              </Button>
            </div>
          )}
        </div>
      </div>

      <ChapterList className="ev-chapters" chapters={chapters} current={p.current} onPick={p.playFrom} />
    </div>
  );
}
