import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { useMediaQuery } from '../lib/useMediaQuery';
import { MQ } from '../theme/breakpoints';
import { useSheetDrag } from '../lib/useSheetDrag';
import { IconButton } from './ui';

// Editing panel. Desktop: right-side drawer, width draggable via the left edge
// and remembered across sessions. Mobile: bottom sheet with a grab handle,
// swipe down to close. Popups (Modal) are reserved for confirmations.
const WIDTH_KEY = 'larvis.drawerWidth';
const MIN_W = 340;
const MAX_W = 900;

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const isSheet = useMediaQuery(MQ.phone);
  const [width, setWidth] = useState(() => {
    const stored = Number(typeof localStorage !== 'undefined' ? localStorage.getItem(WIDTH_KEY) : 0);
    return stored >= MIN_W && stored <= MAX_W ? stored : 480;
  });
  const widthRef = useRef(width);
  const dragging = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { sheetRef, sheetStyle } = useSheetDrag({ enabled: open && isSheet, onClose, bodyRef });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onDown = (e: ReactPointerEvent) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    const w = Math.min(MAX_W, Math.max(MIN_W, Math.round(window.innerWidth - e.clientX)));
    widthRef.current = w;
    setWidth(w);
  };
  const onUp = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    document.body.style.userSelect = '';
    localStorage.setItem(WIDTH_KEY, String(widthRef.current));
  };

  return createPortal(
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <div
        ref={sheetRef}
        className={clsx('drawer', 'glass', 'glass--strong', isSheet && 'drawer--sheet')}
        style={isSheet ? sheetStyle : { width: `min(${width}px, 100vw)` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!isSheet && (
          <div
            className="drawer__resize"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            aria-hidden
          />
        )}
        {isSheet && <div className="sheet-grab" aria-hidden />}
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <IconButton size="sm" label="Schließen" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="drawer__body" ref={bodyRef}>{children}</div>
        {footer && <div className="drawer__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
