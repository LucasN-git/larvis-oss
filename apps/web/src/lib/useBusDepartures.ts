import { useEffect, useState } from 'react';
import { fetchDepartures, type Departure } from './transit';

export interface BusDepartures {
  /** Letzte erfolgreiche Liste, null bis zum ersten Erfolg. */
  deps: Departure[] | null;
  /** Der letzte Abruf ist gescheitert (die alte Liste bleibt stehen). */
  error: boolean;
  updatedAt: number | null;
}

/**
 * Live-Abfahrten an der konfigurierten Haltestelle (lib/transit.ts), alle `refreshMs` neu geladen. Im
 * Hintergrund-Tab wird nicht abgefragt; beim Zurückkehren sofort.
 */
export function useBusDepartures(refreshMs: number): BusDepartures {
  const [state, setState] = useState<BusDepartures>({ deps: null, error: false, updatedAt: null });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const deps = await fetchDepartures();
        if (!cancelled) setState({ deps, error: false, updatedAt: Date.now() });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, error: true }));
      }
    };
    void load();
    const id = setInterval(load, refreshMs);
    const onVisible = () => !document.hidden && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshMs]);

  return state;
}
