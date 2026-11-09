import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { formatRelative } from '../../lib/format';
import { triggerLearnwebSync } from '../../lib/learnweb';

/**
 * Stößt den Learnweb-Sync an und zeigt „Zuletzt synchronisiert: …". Auf der
 * Kurs-Detailseite wird per courseId nur dieser Kurs gesynct.
 */
export function SyncButton({
  courseId,
  lastSyncedAt,
}: {
  courseId?: number;
  lastSyncedAt: string | null;
}) {
  const { notify } = useToast();
  const [running, setRunning] = useState(false);

  const sync = async () => {
    setRunning(true);
    try {
      const r = await triggerLearnwebSync(courseId);
      const parts = [
        r.new_items && `${r.new_items} neue Materialien`,
        r.new_videos && `${r.new_videos} neue Videos`,
        r.new_announcements && `${r.new_announcements} neue Ankündigungen`,
        r.new_events && `${r.new_events} neue Termine`,
      ].filter(Boolean);
      notify(parts.length ? `Sync fertig — ${parts.join(', ')}.` : 'Sync fertig — nichts Neues.', 'info');
      if (r.warnings.length) notify(`${r.warnings.length} Warnung(en) beim Sync.`, 'info');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Sync fehlgeschlagen.', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="row gap-sm center wrap">
      {lastSyncedAt && (
        <span className="item-row__sub" style={{ whiteSpace: 'nowrap' }}>
          Zuletzt: {formatRelative(lastSyncedAt)}
        </span>
      )}
      <Button onClick={sync} disabled={running}>
        <RefreshCw size={16} className={running ? 'spin' : undefined} />
        {running ? 'Synchronisiert…' : 'Synchronisieren'}
      </Button>
    </div>
  );
}
