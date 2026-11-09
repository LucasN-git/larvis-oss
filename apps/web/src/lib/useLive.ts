import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { supabase } from './supabase';
import { cacheGet, cacheSet } from './cache';

export type LiveTable =
  | 'projects'
  | 'todos'
  | 'notes'
  | 'note_attachments'
  | 'learnings'
  | 'learning_attachments'
  | 'learning_sources'
  | 'items'
  | 'agent_tasks'
  | 'contacts'
  | 'places'
  | 'inbox'
  | 'briefings'
  | 'entries'
  | 'learnweb_courses'
  | 'learnweb_items'
  | 'learnweb_videos'
  | 'learnweb_announcements'
  | 'learnweb_events'
  | 'memories';

// Local mutation bus. Same-tab writes refresh their queries immediately instead
// of waiting on the Realtime round-trip. Realtime still drives cross-device sync,
// but it can't be relied on alone: on RLS-protected tables the realtime socket
// only delivers row changes if it carries the user's JWT, so a missed/late
// setAuth would otherwise leave the UI stale after a write (the "nothing happens"
// after adding a todo). Call notifyLocalChange(table) after every successful write.
const localListeners = new Map<string, Set<() => void>>();

export function notifyLocalChange(...tables: LiveTable[]) {
  for (const t of tables) localListeners.get(t)?.forEach((fn) => fn());
}

function subscribeLocal(tables: string[], fn: () => void) {
  for (const t of tables) {
    let set = localListeners.get(t);
    if (!set) localListeners.set(t, (set = new Set()));
    set.add(fn);
  }
  return () => {
    for (const t of tables) localListeners.get(t)?.delete(fn);
  };
}

/**
 * Runs `fetcher` initially and whenever a watched table changes via Supabase
 * Realtime. Re-fetching (rather than patching) keeps results correct under any
 * filter and is cheap for a personal-scale dataset. Bursts are debounced.
 *
 * `deps` re-runs the fetch when filter inputs change (pass primitives).
 *
 * `cacheKey` (optional) turns the hook stale-while-revalidate: cached results
 * paint immediately, the fresh fetch replaces them in the background. The key
 * MUST encode the filter (two hooks with the same key must fetch the same
 * data), best via the deps values.
 */
export function useLiveQuery<T>(
  fetcher: () => Promise<T>,
  tables: LiveTable[],
  deps: ReadonlyArray<unknown> = [],
  cacheKey?: string,
) {
  const [data, setData] = useState<T | null>(() => (cacheKey ? cacheGet<T>(cacheKey) ?? null : null));
  const [loading, setLoading] = useState(data === null);
  const [error, setError] = useState<string | null>(null);

  // Unique per hook instance so multiple watchers of the same table get
  // distinct Realtime channels (Supabase rejects re-using a channel name).
  const channelId = useId();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const run = useCallback(async () => {
    try {
      setError(null);
      const fresh = await fetcherRef.current();
      if (cacheKeyRef.current) cacheSet(cacheKeyRef.current, fresh);
      setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + refetch when filter deps change. On a dep change the
  // cached result for the new key paints first (if present) so filter
  // switches don't flash empty.
  useEffect(() => {
    if (cacheKey) {
      const cached = cacheGet<T>(cacheKey);
      if (cached !== undefined) {
        setData(cached);
        setLoading(false);
      }
    }
    run();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime subscription (debounced refetch).
  const tableKey = tables.join(',');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 150);
    };
    const channel = supabase.channel(`live:${tableKey}:${channelId}`);
    for (const table of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule);
    }
    channel.subscribe();
    // Same-tab writes refresh straight away (no debounce, no socket dependency).
    const offLocal = subscribeLocal(tableKey.split(','), run);
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
      offLocal();
    };
  }, [tableKey, channelId, run]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refetch: run };
}
