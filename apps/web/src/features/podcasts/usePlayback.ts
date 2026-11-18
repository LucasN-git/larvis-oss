import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  chapterIndexAt,
  nextChapterStart,
  previousChapterStart,
  progressAt,
  resumePosition,
  type PodcastChapter,
} from '@larvis/shared';
import { notifyLocalChange, type LiveTable } from '../../lib/useLive';

export const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;
/** Beim Abspielen wird der Stand so oft gespeichert; Pause, Ende und Verlassen speichern sofort. */
const SAVE_EVERY_S = 10;

function readRate(key: string): number {
  try {
    const r = Number(localStorage.getItem(key));
    return (PLAYBACK_RATES as readonly number[]).includes(r) ? r : 1;
  } catch {
    return 1;
  }
}

export const rateLabel = (r: number) => `${String(r).replace('.', ',')}×`;

export interface PlaybackOptions {
  /** Pfad im privaten Bucket; ohne Pfad gibt es nichts abzuspielen. */
  path: string | null;
  /** Signierte URL für den Pfad, null wenn der Storage sie nicht herausgibt. */
  sign: (path: string) => Promise<string | null>;
  /** Länge aus der Datenbank, bis die Datei ihre eigene meldet. */
  durationHint: number | null;
  chapters: PodcastChapter[];
  /** Gespeicherter Stand (Hör- oder Sehstand). */
  progress: { position_s: number; completed: boolean } | null;
  saveProgress: (state: { position_s: number; completed: boolean }) => Promise<void>;
  /** Tabelle des Stands: nach einem Speichern mit Nachladen lädt die Liste sofort neu. */
  progressTable: LiveTable;
  /** localStorage-Schlüssel des Tempos (Hören und Sehen merken sich ihr Tempo getrennt). */
  rateKey: string;
  /** Sprungweiten zurück und vor, auch für die Media Session. */
  backS: number;
  forwardS: number;
  /** Sperrbildschirm und Kopfhörertasten. */
  metadata: { title: string; artist: string; album: string; artwork?: string | null };
}

/**
 * Abspiel-Logik, die der Podcast- und der Video-Player teilen: signierte Quelle (bei Ablauf
 * einmal neu signieren und an derselben Stelle weiter), Fortschritt in der Datenbank
 * (Handy und PC machen an derselben Stelle weiter; beim Öffnen springt der Player einmal
 * dorthin und folgt danach nur noch dem, was läuft), Kapitel vor und zurück, Tempo und Media
 * Session (Kapitel als Titelsprung). Das Medien-Element bekommt `mediaProps`.
 */
export function usePlayback<E extends HTMLMediaElement>(o: PlaybackOptions) {
  const mediaRef = useRef<E>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Erhöhen signiert neu (Knopf „Erneut laden“).
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(() => resumePosition(o.progress));
  const [duration, setDuration] = useState(o.durationHint ?? 0);
  const [rate, setRate] = useState(() => readRate(o.rateKey));
  // Wohin der Player nach dem Laden der Metadaten springt: der Stand beim Öffnen, ein Sprung
  // vor dem Laden, oder die Stelle vor einem Neuladen der Quelle. Danach folgt er dem Abspielen.
  const startAt = useRef(resumePosition(o.progress));
  const lastSaved = useRef(startAt.current);
  // Letzte bekannte Position und Länge: beim Verlassen ist das Element schon abgehängt.
  const posRef = useRef(startAt.current);
  const durRef = useRef(o.durationHint ?? 0);
  // Gespeichert wird erst, wenn abgespielt oder gesprungen wurde; bloßes Öffnen legt keinen Stand an.
  const touched = useRef(false);
  // Zwischen neuer Quelle und loadedmetadata meldet das Element Position 0; die zählt nicht.
  const loading = useRef(true);
  const resigned = useRef(false);
  // Kapitel und Speichern über Refs: ein Neuladen der Liste (Realtime) soll Handler nicht neu setzen.
  const chaptersRef = useRef(o.chapters);
  chaptersRef.current = o.chapters;
  const saveRef = useRef(o.saveProgress);
  saveRef.current = o.saveProgress;
  const signRef = useRef(o.sign);
  signRef.current = o.sign;
  const { path, progressTable, rateKey, backS, forwardS } = o;
  const current = chapterIndexAt(o.chapters, t);

  useEffect(() => {
    let active = true;
    if (!path) {
      setFailed(true);
      return;
    }
    signRef.current(path).then((url) => {
      if (!active) return;
      if (url) setSrc(url);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [path, attempt]);

  // Der erste Stand kann aus dem Cache stammen; ein frischerer (anderes Gerät) gilt, solange
  // hier noch nicht abgespielt oder gesprungen wurde.
  const freshStart = resumePosition(o.progress);
  useEffect(() => {
    if (touched.current || freshStart === startAt.current) return;
    startAt.current = freshStart;
    posRef.current = freshStart;
    lastSaved.current = freshStart;
    const a = mediaRef.current;
    if (a && !loading.current && Number.isFinite(a.duration) && freshStart < a.duration) a.currentTime = freshStart;
    setT(freshStart);
  }, [freshStart]);

  const save = useCallback(
    (notify: boolean) => {
      if (!touched.current || loading.current || !durRef.current) return;
      const state = progressAt(posRef.current, durRef.current);
      lastSaved.current = posRef.current;
      saveRef
        .current(state)
        .then(() => notify && notifyLocalChange(progressTable))
        .catch(() => undefined);
    },
    [progressTable],
  );

  // Verlassen der Seite oder App: Stand sichern.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && save(false);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      save(true);
    };
  }, [save]);

  const seek = useCallback((to: number) => {
    const max = durRef.current > 0 ? durRef.current : Number.POSITIVE_INFINITY;
    const target = Math.max(0, Math.min(max, to));
    touched.current = true;
    posRef.current = target;
    setT(target);
    const a = mediaRef.current;
    // Vor den Metadaten merkt sich der Player das Ziel und springt beim Laden dorthin.
    if (!a || loading.current) startAt.current = target;
    else a.currentTime = target;
  }, []);

  const play = useCallback(() => void mediaRef.current?.play().catch(() => undefined), []);
  const toggle = useCallback(() => {
    const a = mediaRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, []);

  const skip = useCallback((delta: number) => seek(posRef.current + delta), [seek]);
  const prevChapter = useCallback(() => seek(previousChapterStart(chaptersRef.current, posRef.current)), [seek]);
  const nextChapter = useCallback(() => {
    const to = nextChapterStart(chaptersRef.current, posRef.current);
    if (to !== null) seek(to);
  }, [seek]);
  /** Kapitel aus der Liste anspringen und (falls pausiert) abspielen. */
  const playFrom = useCallback(
    (to: number) => {
      seek(to);
      if (mediaRef.current?.paused) play();
    },
    [seek, play],
  );

  const cycleRate = () => {
    const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]) + 1) % PLAYBACK_RATES.length];
    setRate(next);
    try {
      localStorage.setItem(rateKey, String(next));
    } catch {
      /* privater Modus: Tempo gilt nur für diese Sitzung */
    }
  };

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = rate;
  }, [rate, src]);

  // Sperrbildschirm und Kopfhörertasten. iOS zeigt statt Titelsprüngen oft die Spulknöpfe.
  const { title, artist, album, artwork } = o.metadata;
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title, artist, album, ...(artwork ? { artwork: [{ src: artwork }] } : {}) });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void mediaRef.current?.play().catch(() => undefined)],
      ['pause', () => mediaRef.current?.pause()],
      ['seekbackward', (d) => skip(-(d.seekOffset ?? backS))],
      ['seekforward', (d) => skip(d.seekOffset ?? forwardS)],
      ['previoustrack', prevChapter],
      ['nexttrack', nextChapter],
      ['seekto', (d) => d.seekTime !== undefined && seek(d.seekTime)],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* Aktion vom Browser nicht unterstützt */
      }
    }
    return () => {
      ms.metadata = null;
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* s. o. */
        }
      }
    };
  }, [title, artist, album, artwork, skip, prevChapter, nextChapter, seek, backS, forwardS]);

  const syncPositionState = () => {
    const a = mediaRef.current;
    if (!a || !('mediaSession' in navigator) || !Number.isFinite(a.duration)) return;
    try {
      navigator.mediaSession.setPositionState({ duration: a.duration, playbackRate: a.playbackRate, position: a.currentTime });
    } catch {
      /* ungültiger Zwischenstand beim Laden */
    }
  };

  const onError = () => {
    // Abgelaufene Signatur: einmal neu signieren und an derselben Stelle weitermachen.
    setPlaying(false);
    if (resigned.current || !path) {
      setFailed(true);
      return;
    }
    resigned.current = true;
    startAt.current = posRef.current;
    loading.current = true;
    signRef.current(path).then((url) => (url ? setSrc(url) : setFailed(true)));
  };

  const retry = () => {
    setFailed(false);
    setSrc(null);
    resigned.current = false;
    startAt.current = posRef.current;
    loading.current = true;
    setAttempt((n) => n + 1);
  };

  const mediaProps = {
    ref: mediaRef,
    src: src ?? undefined,
    preload: 'metadata' as const,
    onLoadStart: () => {
      loading.current = true;
    },
    onLoadedMetadata: (e: SyntheticEvent<E>) => {
      const a = e.currentTarget;
      if (Number.isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration);
        durRef.current = a.duration;
      }
      a.playbackRate = rate;
      const to = startAt.current;
      if (to > 0 && (!Number.isFinite(a.duration) || to < a.duration)) a.currentTime = to;
      loading.current = false;
      posRef.current = a.currentTime;
      setT(a.currentTime);
      syncPositionState();
    },
    onTimeUpdate: (e: SyntheticEvent<E>) => {
      if (loading.current) return;
      const a = e.currentTarget;
      posRef.current = a.currentTime;
      setT(a.currentTime);
      if (!a.paused && Math.abs(a.currentTime - lastSaved.current) >= SAVE_EVERY_S) save(false);
    },
    onPlay: () => {
      touched.current = true;
      setPlaying(true);
      resigned.current = false;
    },
    onPause: () => {
      setPlaying(false);
      save(true);
    },
    onEnded: (e: SyntheticEvent<E>) => {
      setPlaying(false);
      posRef.current = e.currentTarget.duration;
      save(true);
    },
    onSeeked: syncPositionState,
    onRateChange: syncPositionState,
    onError,
  };

  return {
    mediaRef,
    mediaProps,
    src,
    failed,
    ready: !!src && !failed,
    playing,
    t,
    duration,
    rate,
    current,
    seek,
    toggle,
    skip,
    prevChapter,
    nextChapter,
    playFrom,
    cycleRate,
    retry,
  };
}
