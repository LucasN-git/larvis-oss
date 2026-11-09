import { useCallback, useEffect, useRef, useState } from 'react';

// Stale-while-revalidate Cache für alle Daten-Fetches.
//
// Zwei Ebenen: ein In-Memory-Map für Navigation innerhalb der Session und
// localStorage für den Kaltstart (PWA auf dem Handy). Gecachte Daten werden
// sofort angezeigt, der frische Fetch läuft im Hintergrund und ersetzt sie —
// die App fühlt sich damit instant an statt auf jedes Netzwerk-Roundtrip zu
// warten.

const MEM = new Map<string, unknown>();
const PREFIX = 'larvis.cache.v1:';
// Kaltstart-Cache verfällt nach 24h — danach lieber Spinner als Uralt-Daten.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function cacheGet<T>(key: string): T | undefined {
  if (MEM.has(key)) return MEM.get(key) as T;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const { t, d } = JSON.parse(raw) as { t: number; d: T };
    if (Date.now() - t > MAX_AGE_MS) {
      localStorage.removeItem(PREFIX + key);
      return undefined;
    }
    MEM.set(key, d);
    return d;
  } catch {
    return undefined;
  }
}

export function cacheSet<T>(key: string, data: T): void {
  MEM.set(key, data);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), d: data }));
  } catch {
    // Storage voll o.ä. — Memory-Cache reicht dann.
  }
}

/**
 * SWR-Hook für Fetches außerhalb von Supabase-Tabellen (Kalender, Wetter, …).
 * Zeigt sofort den Cache-Stand (falls vorhanden) und revalidiert im Hintergrund.
 * `key` muss die Fetch-Parameter eindeutig kodieren.
 */
export function useCachedQuery<T>(key: string, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(() => cacheGet<T>(key));
  const [loading, setLoading] = useState(data === undefined);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const fresh = await fetcherRef.current();
      cacheSet(key, fresh);
      setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    const cached = cacheGet<T>(key);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
    } else {
      setData(undefined);
      setLoading(true);
    }
    void refetch();
  }, [key, refetch]);

  return { data, loading, error, refetch };
}
