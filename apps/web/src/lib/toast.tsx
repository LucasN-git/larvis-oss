import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check } from 'lucide-react';
import { MQ } from '../theme/breakpoints';

type ToastKind = 'saved' | 'error' | 'info';

/** A button inside the toast (e.g. „Rückgängig“). Clicking it runs onClick and closes the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface NotifyOptions {
  action?: ToastAction;
  /** Visible time in ms. Default: 2400 (info), 4000 (error), 5000 (with action). */
  duration?: number;
}

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action?: ToastAction;
}

interface ToastApi {
  /** Brief "Gespeichert" chip, top-right. Tablet and desktop; silent on the phone. */
  saved: (text?: string) => void;
  /** General notification, shown on every device (phone included). With
   *  `opts.action` the toast carries a button, e.g. undo after a delete. */
  notify: (text: string, kind?: ToastKind, opts?: NotifyOptions) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

// Framed = tablet and desktop, the same breakpoint that swaps the mobile bottom-nav
// for the sidebar or rail. Per-save toasts are off on the phone by request.
function isFramed(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MQ.framed).matches;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const savedId = useRef<number | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const remove = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  // One "Gespeichert" chip that refreshes its timer on each save instead of
  // stacking a new toast per keystroke-batch.
  const saved = useCallback(
    (text = 'Gespeichert') => {
      if (!isFramed()) return;
      clearTimeout(savedTimer.current);
      setToasts((ts) => {
        const others = ts.filter((t) => t.id !== savedId.current);
        const id = ++seq.current;
        savedId.current = id;
        return [...others, { id, kind: 'saved', text }];
      });
      savedTimer.current = setTimeout(() => {
        if (savedId.current != null) remove(savedId.current);
        savedId.current = null;
      }, 1600);
    },
    [remove],
  );

  const notify = useCallback(
    (text: string, kind: ToastKind = 'info', opts: NotifyOptions = {}) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts, { id, kind, text, action: opts.action }]);
      const fallback = opts.action ? 5000 : kind === 'error' ? 4000 : 2400;
      setTimeout(() => remove(id), opts.duration ?? fallback);
    },
    [remove],
  );

  return (
    <ToastCtx.Provider value={{ saved, notify }}>
      {children}
      {createPortal(
        <div className="toast-stack" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`toast glass toast--${t.kind}${t.action ? ' toast--action' : ''}`}
              role="status"
            >
              {t.kind === 'saved' && <Check size={15} />}
              {t.kind === 'error' && <AlertCircle size={15} />}
              <span className="toast__text">{t.text}</span>
              {t.action && (
                <button
                  type="button"
                  className="toast__action"
                  onClick={() => {
                    t.action?.onClick();
                    remove(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
