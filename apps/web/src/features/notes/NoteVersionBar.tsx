import { CopyPlus, GitCompare } from 'lucide-react';
import { clsx } from 'clsx';
import type { Note } from '@larvis/shared';
import { Button } from '../../components/ui';
import { versionChipLabel } from './noteVersions';

// Schlanke Leiste über dem Inhalt, sobald eine Serie mehr als eine Version hat:
// ein Chip je Version (die gezeigte hervorgehoben), rechts „Vergleichen" und
// „Neue Version" — beides nur auf der aktuellen Version.
export function NoteVersionBar({
  series,
  activeId,
  isCurrent,
  comparing,
  onOpen,
  onCompare,
  onNewVersion,
}: {
  series: Note[];
  activeId: string;
  isCurrent: boolean;
  comparing: boolean;
  onOpen: (note: Note) => void;
  onCompare: () => void;
  onNewVersion: () => void;
}) {
  return (
    <div className="note-versions" role="navigation" aria-label="Versionen">
      <div className="note-versions__chips">
        {series.map((n) => (
          <button
            key={n.id}
            type="button"
            className={clsx('chip', 'note-versions__chip', n.id === activeId && 'chip--active')}
            aria-current={n.id === activeId ? 'page' : undefined}
            onClick={() => n.id !== activeId && onOpen(n)}
            title={n.superseded_at ? 'Eingefrorene Version' : 'Aktuelle Version'}
          >
            {versionChipLabel(n)}
          </button>
        ))}
      </div>
      {isCurrent && (
        <div className="note-versions__actions">
          <Button variant="ghost" size="sm" onClick={onCompare} aria-pressed={comparing}>
            <GitCompare size={14} /> Vergleichen
          </Button>
          <Button variant="ghost" size="sm" onClick={onNewVersion}>
            <CopyPlus size={14} /> Neue Version
          </Button>
        </div>
      )}
    </div>
  );
}
