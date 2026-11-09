import { useMemo, useState } from 'react';
import { diffLines, diffWords } from 'diff';
import type { Note } from '@larvis/shared';
import { Segmented } from '../../components/ui';
import { versionChipLabel } from './noteVersions';

type Granularity = 'lines' | 'words';

// Vergleich einer Version (rechts, „neu") gegen eine wählbare ältere Version der
// Serie. Entferntes ist rot hinterlegt und durchgestrichen, Hinzugefügtes grün.
// Zeilenweise zeigt ganze Absätze, wortweise die Änderung im Satz.
export function NoteDiffView({
  current,
  currentBody,
  older,
  compareId,
  onCompareId,
}: {
  current: Note;
  /** Ungespeicherter Stand des Editors, damit der Vergleich zeigt, was man sieht. */
  currentBody: string;
  /** Ältere Versionen der Serie (ohne `current`), aufsteigend. */
  older: Note[];
  compareId: string;
  onCompareId: (id: string) => void;
}) {
  const [granularity, setGranularity] = useState<Granularity>('lines');
  const base = older.find((n) => n.id === compareId) ?? older[older.length - 1];

  const changes = useMemo(() => {
    if (!base) return [];
    return granularity === 'lines' ? diffLines(base.body_md, currentBody) : diffWords(base.body_md, currentBody);
  }, [base, currentBody, granularity]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const c of changes) {
      if (c.added) added += c.count ?? 0;
      else if (c.removed) removed += c.count ?? 0;
    }
    return { added, removed };
  }, [changes]);

  if (!base) return <div className="empty">Keine ältere Version zum Vergleichen.</div>;

  const unit = granularity === 'lines' ? 'Zeilen' : 'Wörter';

  return (
    <div className="stack gap-sm">
      <div className="note-diff__bar">
        <label className="note-diff__pick">
          <span className="text-muted">Vergleiche</span>
          <select className="input note-diff__select" value={base.id} onChange={(e) => onCompareId(e.target.value)}>
            {older.map((n) => (
              <option key={n.id} value={n.id}>{versionChipLabel(n)}</option>
            ))}
          </select>
          <span className="text-muted">mit v{current.version_no}</span>
        </label>
        <Segmented<Granularity>
          options={[
            { value: 'lines', label: 'Zeilen' },
            { value: 'words', label: 'Wörter' },
          ]}
          value={granularity}
          onChange={setGranularity}
        />
      </div>
      <div className="note-diff__stats text-muted">
        <span className="note-diff__stat note-diff__stat--add">+{stats.added}</span>
        <span className="note-diff__stat note-diff__stat--del">−{stats.removed}</span>
        <span>{unit}</span>
      </div>
      <pre className={`note-diff note-diff--${granularity}`} aria-label="Unterschiede">
        {changes.map((c, i) =>
          c.added ? (
            <ins key={i} className="note-diff__add">{c.value}</ins>
          ) : c.removed ? (
            <del key={i} className="note-diff__del">{c.value}</del>
          ) : (
            <span key={i}>{c.value}</span>
          ),
        )}
      </pre>
    </div>
  );
}
