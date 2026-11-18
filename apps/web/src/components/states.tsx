import type { ReactNode } from 'react';
import { clsx } from 'clsx';

/**
 * Die drei Zustände einer Liste ohne Inhalt, an einer Stelle formuliert:
 * Laden, leer und Fehler. `inGroup` setzt sie als Zeile in eine .group (der Rahmen steht
 * schon), sonst stehen sie frei auf der Seite (.empty). Gezeigt wird „Lädt …" nur ohne
 * Cache-Stand: useLiveQuery malt gecachte Daten sofort, dann gibt es nichts zu warten.
 */

export function Loading({ inGroup = false, label = 'Lädt …' }: { inGroup?: boolean; label?: string }) {
  return (
    <div className={inGroup ? 'group__empty' : 'empty'} role="status" aria-live="polite">
      {label}
    </div>
  );
}

export function EmptyState({ inGroup = false, children, action }: { inGroup?: boolean; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={inGroup ? 'group__empty' : 'empty'}>
      {children}
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}

/** Laden fehlgeschlagen: die Meldung und ein Knopf, der dieselbe Abfrage noch einmal stellt. */
export function ListError({
  error,
  onRetry,
  inGroup = false,
  what = 'Konnte nicht laden',
}: {
  error: string;
  onRetry?: () => void;
  inGroup?: boolean;
  what?: string;
}) {
  return (
    <div className={clsx(inGroup ? 'group__empty' : 'empty', 'state-error')} role="alert">
      {what}: {error}
      {onRetry && (
        <div className="state-action">
          <button type="button" className="link-btn" onClick={onRetry}>
            Erneut versuchen
          </button>
        </div>
      )}
    </div>
  );
}
