import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { useMediaQuery } from '../lib/useMediaQuery';
import { MQ } from '../theme/breakpoints';
import { useSheetDrag } from '../lib/useSheetDrag';
import { IconButton } from './ui';

export function Modal({
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const { sheetRef, sheetStyle } = useSheetDrag({ enabled: open && isSheet, onClose, bodyRef });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className={clsx('modal-backdrop', isSheet && 'modal-backdrop--sheet')} onMouseDown={onClose}>
      <div
        ref={sheetRef}
        className={clsx('modal', 'glass', 'glass--strong', isSheet && 'modal--sheet')}
        style={isSheet ? sheetStyle : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {isSheet && <div className="sheet-grab" aria-hidden />}
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <IconButton size="sm" label="Schließen" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="modal__body" ref={bodyRef}>{children}</div>
        {footer && (
          <div className="modal__foot">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
