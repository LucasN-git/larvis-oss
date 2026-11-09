import { useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Options<T> {
  /** The current editable value. A deep change (JSON) schedules a save. */
  value: T;
  /** Persist the value (create-or-update is the caller's concern). */
  onSave: (value: T) => Promise<void>;
  /** Turn autosave off entirely (e.g. read-only records). */
  enabled?: boolean;
  /** Debounce before saving, in ms. */
  delay?: number;
  /** Gate: only save when valid (e.g. a title/name is present). */
  canSave?: (value: T) => boolean;
  /** Called after each successful save (e.g. to show a toast). */
  onSaved?: () => void;
}

/**
 * Debounced autosave. Saves when `value` changes, never on the initial mount,
 * and flushes any pending change when the editor unmounts (drawer closed).
 * Concurrent saves are serialised; a change made mid-save re-runs afterwards.
 */
export function useAutosave<T>({
  value,
  onSave,
  enabled = true,
  delay = 800,
  canSave = () => true,
  onSaved,
}: Options<T>) {
  const [state, setState] = useState<SaveState>('idle');

  // Refs so the debounce/unmount closures always see current values.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const canSaveRef = useRef(canSave);
  canSaveRef.current = canSave;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const valueRef = useRef(value);
  valueRef.current = value;

  const lastSaved = useRef(JSON.stringify(value)); // snapshot of last persisted value
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef(false);
  const rerun = useRef(false);
  const mounted = useRef(true);

  const flush = useRef(async () => {
    clearTimeout(timer.current);
    const snapshot = JSON.stringify(valueRef.current);
    if (snapshot === lastSaved.current) return; // nothing changed
    if (!canSaveRef.current(valueRef.current)) return; // not valid yet
    if (inFlight.current) {
      rerun.current = true; // a save is running; pick up this change after
      return;
    }
    inFlight.current = true;
    if (mounted.current) setState('saving');
    try {
      await onSaveRef.current(valueRef.current);
      lastSaved.current = snapshot;
      if (mounted.current) setState('saved');
      onSavedRef.current?.();
    } catch {
      if (mounted.current) setState('error');
    } finally {
      inFlight.current = false;
      if (rerun.current) {
        rerun.current = false;
        void flush.current();
      }
    }
  });

  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!enabled) return;
    if (serialized === lastSaved.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush.current(), delay);
    return () => clearTimeout(timer.current);
  }, [serialized, enabled, delay]);

  // Persist a pending change when the editor closes.
  useEffect(() => {
    return () => {
      mounted.current = false;
      void flush.current();
    };
  }, []);

  return { state, flush: () => flush.current() };
}
