import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { groupMachen, type Entry } from '@larvis/shared';
import { listContextProjects, listEntries, setEntryDone } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { useToast } from '../../lib/toast';
import { EntryRow } from './EntryList';
import { EntryEditorModal } from './EntryEditorModal';

// „Machen": die Einträge mit Tag nachmachen oder umsetzen, die noch nicht abgehakt sind, je
// Kontext eine Gruppe in der Reihenfolge des Projekte-Tabs, Einträge ohne Kontext zuletzt in
// „Ohne Kontext" (Regeln in @larvis/shared, machen.ts). Die Liste liest dieselben Einträge wie
// die Inbox (gleicher Cache) und filtert selbst. Der Haken setzt done_at: der Eintrag
// verschwindet sofort, der Toast holt ihn zurück, in der Inbox bleibt er stehen. Ein Klick auf
// die Zeile öffnet denselben Editor wie die Inbox.

export function MachenList() {
  const { notify } = useToast();
  const { data: entries, loading, error } = useLiveQuery(() => listEntries(), ['entries'], [], 'entries:all');
  const { data: projects } = useLiveQuery(listContextProjects, ['projects'], [], 'projects:contexts');

  // Abgehakte Einträge verschwinden sofort; die id bleibt nur so lange hier, bis die Liste sie
  // vom Server als abgehakt bringt (oder das Abhaken scheitert).
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!entries) return;
    setChecked((prev) => {
      const still = [...prev].filter((id) => entries.some((e) => e.id === id && !e.done_at));
      return still.length === prev.size ? prev : new Set(still);
    });
  }, [entries]);
  const setCheckedId = (id: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const groups = useMemo(
    () => (entries && projects ? groupMachen(entries.filter((e) => !checked.has(e.id)), projects) : null),
    [entries, projects, checked],
  );

  const checkOff = async (e: Entry) => {
    setCheckedId(e.id, true);
    try {
      await setEntryDone(e.id, true);
    } catch {
      setCheckedId(e.id, false);
      notify('Abhaken fehlgeschlagen', 'error');
      return;
    }
    notify(`„${e.name}“ erledigt`, 'info', {
      action: {
        label: 'Rückgängig',
        onClick: () => {
          setCheckedId(e.id, false);
          void setEntryDone(e.id, false).catch(() => notify('Zurückholen fehlgeschlagen', 'error'));
        },
      },
    });
  };

  const [editing, setEditing] = useState<Entry | null>(null);

  return (
    <div className="stack gap-md">
      {error && <div className="empty">Die Einträge ließen sich nicht laden: {error}</div>}
      {!error && !groups && loading && <div className="text-muted" style={{ fontSize: 13 }}>Lädt …</div>}
      {!error && groups?.length === 0 && (
        <div className="empty">
          Nichts zu machen. Einträge mit dem Tag <Link to="/inbox?tag=nachmachen">nachmachen</Link> oder{' '}
          <Link to="/inbox?tag=umsetzen">umsetzen</Link> erscheinen hier; abgehakte bleiben in der Inbox.
        </div>
      )}

      {groups?.map(({ project, entries: list }) => {
        const color = project?.color ?? 'var(--accent)';
        return (
          <section key={project?.id ?? 'ohne'} className="stack gap-xs">
            <div className="section-title" style={{ margin: 0 }}>
              <span className="machen-dot" style={{ background: color }} aria-hidden />
              {project ? project.name : 'Ohne Kontext'} <span style={{ fontWeight: 400 }}>({list.length})</span>
            </div>
            <div className="group group--tile">
              {list.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  shared={0}
                  learnings={[]}
                  onEdit={() => setEditing(e)}
                  lead={
                    <span className="machen-lead">
                      <button
                        type="button"
                        className="check check--proj"
                        style={{ '--proj': color } as CSSProperties}
                        aria-label={`${e.name} abhaken (erledigt)`}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void checkOff(e);
                        }}
                      >
                        <Check size={15} strokeWidth={3} />
                      </button>
                    </span>
                  }
                />
              ))}
            </div>
          </section>
        );
      })}

      {editing && (
        <EntryEditorModal
          key={editing.id}
          entry={editing}
          open
          onClose={() => setEditing(null)}
          siblings={[]}
          entries={entries ?? []}
        />
      )}
    </div>
  );
}
