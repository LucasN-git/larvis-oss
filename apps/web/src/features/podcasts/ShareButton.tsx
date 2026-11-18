import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'lucide-react';
import { useToast } from '../../lib/toast';

type Phase = { kind: 'idle' } | { kind: 'loading'; pct: number | null } | { kind: 'ready' };

/**
 * Teilen einer Folge oder eines Videos als Datei: lädt die MP4 einmal in den Speicher und reicht
 * sie an das Teilen-Menü des Geräts (WhatsApp, AirDrop, Mail …). Wo der Browser keine Dateien
 * teilen kann (etwa Firefox am Rechner), wird die Datei stattdessen gespeichert.
 *
 * Das Teilen-Menü öffnet sich nur aus einem frischen Tipp heraus. Dauert das Laden länger, als
 * der Browser den Tipp gelten lässt (Safari), wird der Knopf zu „Senden“, und der zweite Tipp
 * öffnet das Menü. Verweigert der Browser das Teilen auch bei einem frischen Tipp, gilt das als
 * Fehler. Die geladene Datei bleibt für weitere Tipps im Speicher, solange der Player offen ist.
 */
export function ShareButton({
  path,
  sign,
  fileName,
  title,
}: {
  path: string;
  sign: (path: string) => Promise<string | null>;
  fileName: string;
  title: string;
}) {
  const { notify } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const fileRef = useRef<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fileRef.current = null;
    setPhase({ kind: 'idle' });
    return () => abortRef.current?.abort();
  }, [path]);

  const hand = useCallback(
    async (file: File, freshGesture: boolean) => {
      const data: ShareData = { files: [file], title };
      if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
        try {
          await navigator.share(data);
          setPhase({ kind: 'idle' });
        } catch (e) {
          const name = (e as DOMException)?.name;
          // Abgebrochen: nichts zu melden. Tipp nach dem Laden verfallen: zweiter Tipp auf „Senden“.
          if (name === 'AbortError') setPhase({ kind: 'idle' });
          else if (name === 'NotAllowedError' && !freshGesture) setPhase({ kind: 'ready' });
          else {
            setPhase({ kind: 'idle' });
            notify('Teilen hat nicht geklappt.', 'error');
          }
        }
        return;
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setPhase({ kind: 'idle' });
      notify('Teilen geht in diesem Browser nicht, das Video wird gespeichert.', 'info');
    },
    [notify, title],
  );

  const load = useCallback(async (): Promise<File | null> => {
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase({ kind: 'loading', pct: null });
    try {
      const url = await sign(path);
      if (!url) throw new Error('nicht signiert');
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        if (total > 0) setPhase({ kind: 'loading', pct: Math.min(99, Math.round((got / total) * 100)) });
      }
      const file = new File(parts as BlobPart[], fileName, { type: 'video/mp4' });
      fileRef.current = file;
      return file;
    } catch (e) {
      if (!ac.signal.aborted) {
        setPhase({ kind: 'idle' });
        notify('Das Video lässt sich gerade nicht laden.', 'error');
        console.warn('Teilen: Laden fehlgeschlagen', e);
      }
      return null;
    }
  }, [fileName, notify, path, sign]);

  const onClick = useCallback(async () => {
    if (phase.kind === 'loading') return;
    const cached = fileRef.current;
    if (cached) return hand(cached, true);
    const file = await load();
    if (file) await hand(file, false);
  }, [hand, load, phase.kind]);

  const label =
    phase.kind === 'loading'
      ? phase.pct === null
        ? 'Lädt …'
        : `Lädt ${phase.pct} %`
      : phase.kind === 'ready'
        ? 'Senden'
        : 'Teilen';

  return (
    <button
      type="button"
      className={phase.kind === 'ready' ? 'chip chip--active pod-share' : 'chip pod-share'}
      onClick={onClick}
      disabled={phase.kind === 'loading'}
      aria-label={phase.kind === 'ready' ? 'Video senden' : 'Als Video teilen'}
      aria-busy={phase.kind === 'loading' || undefined}
    >
      <Share size={15} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
