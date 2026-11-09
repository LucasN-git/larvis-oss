import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PictureInPicture2, RectangleHorizontal, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, IconButton, Segmented } from '../../components/ui';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { MQ } from '../../theme/breakpoints';
import { useToast } from '../../lib/toast';

const RATES = ['1', '1.25', '1.5', '1.75', '2'] as const;
type Rate = (typeof RATES)[number];
const RATE_KEY = 'larvis.video-rate';
// Fortschritt pro eLecture (nicht pro Stream — Folien und Kamera teilen die
// Position). Nahe dem Ende wird der Eintrag gelöscht: nächster Start bei 0.
const posKey = (videoId: string) => `larvis.video-pos.${videoId}`;
const POS_SAVE_INTERVAL_MS = 5000;
const POS_END_SLACK_S = 10;

function readStoredPosition(videoId: string): number {
  const raw = Number(localStorage.getItem(posKey(videoId)));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}
// iOS feuert `pause` beim Sperren/App-Wechsel kurz BEVOR die Seite hidden wird.
// So lange warten wir, bevor eine sichtbare Pause als Nutzerwunsch gilt.
const USER_PAUSE_GRACE_MS = 350;

/** Browser-Sonderfälle, die (noch) nicht in lib.dom stehen. */
type VideoEl = HTMLVideoElement & {
  autoPictureInPicture?: boolean;
  webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline' | 'fullscreen') => void;
  webkitPresentationMode?: string;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
};
type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock?: () => void;
};

function inPictureInPicture(v: VideoEl): boolean {
  return document.pictureInPictureElement === v || v.webkitPresentationMode === 'picture-in-picture';
}

/**
 * eLecture-Videoelement mit Mobile-Extras:
 * - Standby/Hintergrund: MediaSession (Lockscreen-Controls) + Keep-Alive, das
 *   OS-erzwungene Pausen wieder anspielt. Nutzer-Pausen werden per Karenzzeit
 *   unterschieden, weil iOS `pause` vor dem visibilitychange feuert.
 * - Geschwindigkeit 1–2× (persistiert über localStorage).
 * - Querformat-Button: Fullscreen + Orientation-Lock; ohne Lock-API (iOS) ein
 *   Pseudo-Fullscreen mit 90° gedrehtem Frame (Video + Exit drehen gemeinsam).
 * - Bild-in-Bild: Standard-API, sonst Safaris Presentation-Mode; Fehler und
 *   Ablehnungen melden sich als Toast statt still zu scheitern. Auto-PiP beim
 *   Weg-Swipen, wo der Browser es erlaubt (Safari autoPictureInPicture,
 *   Chrome enterpictureinpicture-Action; Chrome/Android außerdem automatisch,
 *   wenn das Video beim Verlassen im Fullscreen läuft).
 *
 * Bei src-Wechsel (Folien ↔ Kamera) bleiben Position und Tempo erhalten; die
 * Position wird außerdem pro eLecture persistiert (Wiedereinstieg beim Öffnen).
 */
export function VideoPlayer({ src, title, videoId }: { src: string; title: string; videoId: string }) {
  const { notify } = useToast();
  const isPhone = useMediaQuery(MQ.phone);
  const videoRef = useRef<VideoEl>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rate, setRate] = useState<Rate>(() => {
    const stored = localStorage.getItem(RATE_KEY);
    return RATES.includes(stored as Rate) ? (stored as Rate) : '1';
  });
  const [fakeLandscape, setFakeLandscape] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  // Merkt die Abspielabsicht: true solange der User nicht selbst pausiert hat.
  const wantsPlay = useRef(false);
  const graceTimer = useRef<number | undefined>(undefined);
  const retryTimers = useRef<number[]>([]);
  // Laufende Abspielposition (nur für den committeten src). Beim src-Wechsel
  // wird sie eingefroren (resumeTo), damit das Reset-timeupdate(0) sie nicht
  // überschreibt, bevor loadedmetadata wiederherstellt. Startwert = zuletzt
  // gespeicherter Fortschritt → das erste loadedmetadata springt dorthin.
  const positionRef = useRef(readStoredPosition(videoId));
  const resumeTo = useRef(0);
  const loadingRef = useRef(false);
  const lastSaveAt = useRef(0);

  // Fortschritt sichern; kurz vor dem Ende (oder danach) stattdessen löschen,
  // damit die nächste Wiedergabe vorn beginnt.
  const savePosition = useCallback(() => {
    const v = videoRef.current;
    const pos = positionRef.current;
    const nearEnd = v && Number.isFinite(v.duration) && pos >= v.duration - POS_END_SLACK_S;
    if (v?.ended || nearEnd || pos <= 1) localStorage.removeItem(posKey(videoId));
    else localStorage.setItem(posKey(videoId), String(Math.floor(pos)));
  }, [videoId]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setPipSupported(
      Boolean(document.pictureInPictureEnabled) ||
        v.webkitSupportsPresentationMode?.('picture-in-picture') === true ||
        typeof v.webkitSetPresentationMode === 'function',
    );
    v.autoPictureInPicture = true; // Safari: PiP automatisch beim App-Wechsel
  }, []);

  const changeRate = useCallback((next: Rate) => {
    setRate(next);
    localStorage.setItem(RATE_KEY, next);
    if (videoRef.current) videoRef.current.playbackRate = Number(next);
  }, []);

  // Direkt nach dem DOM-Commit des neuen src (synchron, vor den Media-Events):
  // aktuelle Position einfrieren und Ladephase markieren.
  useLayoutEffect(() => {
    resumeTo.current = positionRef.current;
    loadingRef.current = true;
  }, [src]);

  // src-Wechsel: Position/Tempo nach dem Neuladen wiederherstellen.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const restore = () => {
      v.playbackRate = Number(rate);
      if (loadingRef.current && resumeTo.current > 1 && resumeTo.current < v.duration) {
        v.currentTime = resumeTo.current;
      }
      loadingRef.current = false;
    };
    v.addEventListener('loadedmetadata', restore);
    return () => v.removeEventListener('loadedmetadata', restore);
  }, [src, rate]);

  // Keep-Alive + MediaSession: Ton läuft bei Standby/Hintergrund weiter,
  // Lockscreen bekommt Titel und Play/Pause/Seek.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const setMsState = (state: MediaSessionPlaybackState) => {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
    };
    const clearRetries = () => {
      retryTimers.current.forEach((t) => window.clearTimeout(t));
      retryTimers.current = [];
    };
    const resume = () => {
      if (!wantsPlay.current || v.ended || inPictureInPicture(v)) return;
      if (v.paused) v.play().catch(() => undefined);
    };
    // Nachfass-Versuche gelten nur solange die Seite hidden ist — sonst würde
    // ein liegengebliebener Timer eine spätere Nutzer-Pause übersteuern.
    const resumeIfHidden = () => {
      if (document.hidden) resume();
    };

    const onPlay = () => {
      wantsPlay.current = true;
      setMsState('playing');
    };
    const onPause = () => {
      savePosition();
      if (v.ended || inPictureInPicture(v)) {
        // Ende bzw. Pause im PiP-Fenster = Nutzerwunsch.
        wantsPlay.current = false;
        setMsState('paused');
        return;
      }
      if (document.hidden) {
        // Seite schon hidden (Display aus / Hintergrund): OS-Pause → weiterspielen.
        resume();
        return;
      }
      // Sichtbar pausiert: entweder der User — oder iOS beim Sperren, wo
      // `pause` dem visibilitychange vorausgeht. Kurz warten, dann entscheiden.
      window.clearTimeout(graceTimer.current);
      graceTimer.current = window.setTimeout(() => {
        if (document.hidden) {
          resume();
        } else {
          wantsPlay.current = false;
          clearRetries();
          setMsState('paused');
        }
      }, USER_PAUSE_GRACE_MS);
    };
    const onTime = () => {
      // Während des src-Wechsels nicht mitschreiben (Reset auf 0 ignorieren).
      if (loadingRef.current) return;
      positionRef.current = v.currentTime;
      const now = Date.now();
      if (now - lastSaveAt.current >= POS_SAVE_INTERVAL_MS) {
        lastSaveAt.current = now;
        savePosition();
      }
    };
    const onEnded = () => {
      localStorage.removeItem(posKey(videoId));
      positionRef.current = 0;
    };
    const onVisibility = () => {
      if (document.hidden) {
        savePosition();
        // Sperren/App-Wechsel erkannt: schwebende Pause nicht als User werten.
        window.clearTimeout(graceTimer.current);
        resume();
        // iOS/Android pausieren teils erst NACH dem visibilitychange nochmal —
        // kurze Nachfass-Versuche, bevor der Prozess eingefroren wird.
        clearRetries();
        retryTimers.current.push(
          window.setTimeout(resumeIfHidden, 300),
          window.setTimeout(resumeIfHidden, 1200),
        );
      } else {
        // Zurück in der App: liegengebliebene Retries weg; hat das OS die
        // Wiedergabe im Hintergrund blockiert, jetzt nahtlos weiterspielen.
        clearRetries();
        resume();
      }
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    document.addEventListener('visibilitychange', onVisibility);

    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      ms.metadata = new MediaMetadata({ title, artist: 'Learnweb · Larvis' });
      ms.setActionHandler('play', () => {
        wantsPlay.current = true;
        v.play().catch(() => undefined);
      });
      ms.setActionHandler('pause', () => {
        window.clearTimeout(graceTimer.current);
        clearRetries();
        wantsPlay.current = false;
        v.pause();
      });
      ms.setActionHandler('seekbackward', () => {
        v.currentTime = Math.max(0, v.currentTime - 10);
      });
      ms.setActionHandler('seekforward', () => {
        v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10);
      });
      ms.setActionHandler('seekto', (d) => {
        if (d.seekTime != null) v.currentTime = d.seekTime;
      });
      // Chrome ≥120: erlaubt Auto-PiP beim Verlassen des Tabs/der App.
      try {
        ms.setActionHandler('enterpictureinpicture' as MediaSessionAction, () => {
          v.requestPictureInPicture?.().catch(() => undefined);
        });
      } catch {
        // Action unbekannt — Browser ohne Auto-PiP.
      }
    }

    return () => {
      savePosition();
      window.clearTimeout(graceTimer.current);
      clearRetries();
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
      document.removeEventListener('visibilitychange', onVisibility);
      if ('mediaSession' in navigator) {
        const ms = navigator.mediaSession;
        ms.metadata = null;
        for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'enterpictureinpicture']) {
          try {
            ms.setActionHandler(a as MediaSessionAction, null);
          } catch {
            // Action unbekannt — ignorieren.
          }
        }
      }
    };
  }, [title, videoId, savePosition]);

  // Orientation-Lock beim Verlassen des Fullscreens wieder freigeben.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) (screen.orientation as LockableOrientation | undefined)?.unlock?.();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Im Pseudo-Fullscreen darf die Seite dahinter nicht scrollen.
  useEffect(() => {
    if (!fakeLandscape) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [fakeLandscape]);

  const toggleLandscape = useCallback(async () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (fakeLandscape) {
      setFakeLandscape(false);
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    const orientation = screen.orientation as LockableOrientation | undefined;
    if (wrap.requestFullscreen && orientation?.lock) {
      try {
        await wrap.requestFullscreen();
        await orientation.lock('landscape');
        return;
      } catch {
        // Desktop: Fullscreen ohne Lock reicht. Sonst → CSS-Fallback.
        if (document.fullscreenElement) return;
      }
    }
    // iOS/Safari: kein Element-Fullscreen bzw. kein Orientation-Lock.
    setFakeLandscape(true);
  }, [fakeLandscape]);

  const togglePip = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (inPictureInPicture(v)) {
        if (document.pictureInPictureElement === v) await document.exitPictureInPicture();
        else v.webkitSetPresentationMode?.('inline');
        return;
      }
      if (v.readyState < 1) {
        notify('Video lädt noch — gleich nochmal versuchen.', 'info');
        return;
      }
      if (document.pictureInPictureEnabled && v.requestPictureInPicture) {
        await v.requestPictureInPicture();
      } else if (typeof v.webkitSetPresentationMode === 'function') {
        // Safari (iPhone/iPad/Mac): wirft nicht — danach prüfen, ob der
        // Wechsel wirklich stattfand, sonst wäre der Klick stumm.
        v.webkitSetPresentationMode('picture-in-picture');
        window.setTimeout(() => {
          if (v.webkitPresentationMode !== 'picture-in-picture') {
            notify(
              'Bild-in-Bild wurde vom Browser abgelehnt. Auf dem iPhone: Larvis in Safari öffnen — als Home-Screen-App erlaubt iOS kein PiP.',
              'info',
            );
          }
        }, 400);
      } else {
        notify('Bild-in-Bild wird von diesem Browser nicht unterstützt.', 'info');
      }
    } catch (e) {
      notify(`Bild-in-Bild nicht möglich: ${e instanceof Error ? e.message : 'unbekannter Fehler'}`, 'error');
    }
  }, [notify]);

  return (
    <div className="stack gap-sm">
      <div ref={wrapRef} className={clsx('video-player', fakeLandscape && 'video-player--flipped')}>
        {/* Frame ist dauerhaft im DOM (Umhängen würde die Wiedergabe abbrechen)
            und wird im Pseudo-Fullscreen als gedrehter Querformat-Screen gestylt. */}
        <div className="video-player__frame">
          <video
            ref={videoRef}
            className="video-player__video"
            controls
            autoPlay
            playsInline
            preload="metadata"
            src={src}
          />
          {fakeLandscape && (
            <IconButton
              label="Querformat beenden"
              className="video-player__exit"
              onClick={() => setFakeLandscape(false)}
            >
              <X size={18} />
            </IconButton>
          )}
        </div>
      </div>
      <div className="video-player__controls">
        {isPhone ? (
          // Handy: nur das aktuelle Tempo zeigen; Tippen schaltet zyklisch weiter.
          <Button
            size="sm"
            className="video-player__rate-cycle"
            aria-label={`Geschwindigkeit ändern (aktuell ${rate}×)`}
            onClick={() => changeRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])}
          >
            {rate}×
          </Button>
        ) : (
          <Segmented
            className="video-player__rates"
            options={RATES.map((r) => ({ value: r, label: `${r}×` }))}
            value={rate}
            onChange={changeRate}
          />
        )}
        {pipSupported && (
          <IconButton label="Bild-in-Bild" onClick={togglePip}>
            <PictureInPicture2 size={18} />
          </IconButton>
        )}
        <IconButton label="Querformat" onClick={toggleLandscape}>
          <RectangleHorizontal size={18} />
        </IconButton>
      </div>
    </div>
  );
}
