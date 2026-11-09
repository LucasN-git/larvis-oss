import { useCallback } from 'react';
import { startGoogleConnect } from '../../lib/calendar';
import { useToast } from '../../lib/toast';

/** Klick-Handler für „Kalender verbinden": startet den Google-Login, ein Fehler erscheint als Toast. */
export function useGoogleConnect(): () => void {
  const { notify } = useToast();
  return useCallback(() => {
    startGoogleConnect().catch((e) => notify(e instanceof Error ? e.message : String(e), 'error'));
  }, [notify]);
}
