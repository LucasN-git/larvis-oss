import { useEffect, useRef, useState, type RefObject } from 'react';

// Swipe-down-to-close für Bottom-Sheets (Drawer/Modal auf dem Handy).
//
// Native Touch-Listener mit passive:false, weil Reacts synthetische
// touchmove-Handler passiv sind und preventDefault dort wirkungslos wäre.
// Die Geste wird nur gekapert, wenn sie klar vertikal nach unten geht und der
// scrollbare Inhalt (bodyRef) ganz oben steht — sonst scrollt der Inhalt normal.
const CLOSE_PX = 110;

export function useSheetDrag({
  enabled,
  onClose,
  bodyRef,
}: {
  enabled: boolean;
  onClose: () => void;
  /** Der intern scrollende Bereich; Gesten darin ziehen erst ab scrollTop 0. */
  bodyRef?: RefObject<HTMLElement | null>;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Aktueller Drag-Stand als Ref, damit onEnd nicht in einem setState-Updater
  // auf den Wert zugreifen muss (onClose dort löst "setState in render" aus).
  const dragYRef = useRef(0);
  const closing = useRef(false);

  useEffect(() => {
    const el = sheetRef.current;
    if (!enabled || !el) return;
    let startX = 0;
    let startY = 0;
    let active = false;
    let decided = false;
    let hijacked = false;

    const mayHijack = (target: EventTarget | null) => {
      const scroller = bodyRef?.current;
      if (!scroller) return true;
      if (!(target instanceof Node) || !scroller.contains(target)) return true;
      return scroller.scrollTop <= 0;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      active = true;
      decided = false;
      hijacked = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = true;
        hijacked = dy > 0 && Math.abs(dy) > Math.abs(dx) && mayHijack(e.target);
        if (hijacked) setDragging(true);
        else active = false;
      }
      if (!hijacked) return;
      e.preventDefault();
      dragYRef.current = Math.max(0, dy);
      setDragY(dragYRef.current);
    };

    const onEnd = () => {
      if (!active && !hijacked) return;
      active = false;
      hijacked = false;
      setDragging(false);
      if (dragYRef.current > CLOSE_PX && !closing.current) {
        closing.current = true;
        onClose();
      } else {
        dragYRef.current = 0;
        setDragY(0);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, onClose, bodyRef]);

  const sheetStyle = {
    transform: dragY ? `translateY(${dragY}px)` : undefined,
    transition: dragging ? 'none' : 'transform 220ms cubic-bezier(0.32, 0.72, 0.24, 1)',
  } as const;

  return { sheetRef, sheetStyle, dragging };
}
