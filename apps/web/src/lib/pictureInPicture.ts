// Bild-in-Bild für Videos (Learnweb-Aufzeichnungen und Erklärvideos): die Standard-API, sonst
// Safaris Presentation-Mode. Fehler und Ablehnungen melden sich als Toast statt still zu scheitern.

/** Browser-Sonderfälle, die (noch) nicht in lib.dom stehen. */
export type PipVideoElement = HTMLVideoElement & {
  autoPictureInPicture?: boolean;
  webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline' | 'fullscreen') => void;
  webkitPresentationMode?: string;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  /** iOS: Vollbild nur für das Video-Element, mit den Bedienelementen des Systems. */
  webkitEnterFullscreen?: () => void;
};

export type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock?: () => void;
};

type Notify = (message: string, tone: 'info' | 'error') => void;

export function inPictureInPicture(v: PipVideoElement): boolean {
  return document.pictureInPictureElement === v || v.webkitPresentationMode === 'picture-in-picture';
}

export function pictureInPictureSupported(v: PipVideoElement): boolean {
  return (
    Boolean(document.pictureInPictureEnabled) ||
    v.webkitSupportsPresentationMode?.('picture-in-picture') === true ||
    typeof v.webkitSetPresentationMode === 'function'
  );
}

/** Bild-in-Bild an oder aus; was nicht geht, meldet `notify`. */
export async function togglePictureInPicture(v: PipVideoElement, notify: Notify): Promise<void> {
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
}
