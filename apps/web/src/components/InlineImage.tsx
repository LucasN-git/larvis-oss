import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

// Inline note image with a drag-to-resize handle. Loads the private file via a
// signed URL (resolved by the parent), renders at `width` px (or natural size
// capped to the container), and reports a new width on drag end so the editor
// can persist it into the markdown body (`#w=NNN`). Double-click the handle
// resets to natural width.
const MIN_W = 60;

export function InlineImage({
  attachmentId,
  alt,
  width,
  resolveUrl,
  onResize,
}: {
  attachmentId: string;
  alt: string;
  width?: number;
  resolveUrl: (id: string) => Promise<string | null>;
  onResize?: (width: number | null) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [dragW, setDragW] = useState<number | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    resolveUrl(attachmentId)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [attachmentId, resolveUrl]);

  const maxW = () => wrapRef.current?.parentElement?.clientWidth ?? 9999;
  const shown = dragW ?? width;

  const onDown = (e: ReactPointerEvent) => {
    if (!onResize) return;
    e.preventDefault();
    e.stopPropagation();
    const cur = wrapRef.current?.querySelector('img')?.clientWidth ?? width ?? MIN_W;
    drag.current = { startX: e.clientX, startW: cur };
    setDragW(cur);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const next = Math.max(MIN_W, Math.min(maxW(), drag.current.startW + (e.clientX - drag.current.startX)));
    setDragW(next);
  };
  const onUp = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const final = dragW;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragW(null);
    if (final && onResize) onResize(Math.round(final));
  };

  if (failed) return <span className="inline-img inline-img--failed">🖼️ {alt || 'Bild nicht ladbar'}</span>;

  return (
    <span className="inline-img" ref={wrapRef} style={{ width: shown ? Math.round(shown) : undefined }}>
      {url ? (
        <img src={url} alt={alt} draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="inline-img__placeholder" style={{ width: shown ?? 240 }} aria-label="lädt…" />
      )}
      {onResize && url && (
        <span
          className="inline-img__handle"
          role="slider"
          aria-label="Bildbreite ziehen"
          title="Ziehen zum Skalieren · Doppelklick = Originalgröße"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onResize(null);
          }}
        />
      )}
      {dragW && <span className="inline-img__badge">{Math.round(dragW)}px</span>}
    </span>
  );
}
