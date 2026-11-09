import { useCallback, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import type { Area, Item } from '@larvis/shared';
import { listItems } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Button, Chip, TextInput } from '../../components/ui';
import { ItemEditorModal } from './ItemEditorModal';

export function ItemsList({ area, projectId }: { area?: Area; projectId?: string | null }) {
  const [query, setQuery] = useState('');
  const filter = { area, projectId, query: query.trim() || undefined };
  const filterKey = JSON.stringify(filter);
  const fetcher = useCallback(() => listItems(filter), [filterKey]);
  const { data: items, loading } = useLiveQuery(fetcher, ['items'], [filterKey], `items:${filterKey}`);

  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack gap-md">
      <div className="quick-add">
        <TextInput placeholder="Suchen: wo liegt …?" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="primary" onClick={() => setCreating(true)} aria-label="Hinzufügen">
          <Plus size={18} />
        </Button>
      </div>

      {items && items.length === 0 && !loading && (
        <div className="empty">{query ? 'Nichts gefunden.' : 'Noch keine Dinge erfasst.'}</div>
      )}

      {items && items.length > 0 && (
        <div className="group group--tile">
          {items.map((it) => (
            <button key={it.id} className="item-row" style={{ textAlign: 'left' }} onClick={() => setEditing(it)}>
              <div className="icon-tile icon-tile--sm">
                <MapPin size={14} />
              </div>
              <div className="item-row__main">
                <div className="item-row__title">{it.name}</div>
                <div className="item-row__sub">{it.location || 'Kein Ort hinterlegt'}</div>
              </div>
              {it.category && <Chip>{it.category}</Chip>}
            </button>
          ))}
        </div>
      )}

      {creating && (
        <ItemEditorModal
          item={null}
          open
          onClose={() => setCreating(false)}
          defaultArea={projectId ? 'project' : area ?? 'personal'}
          defaultProjectId={projectId ?? null}
        />
      )}
      {editing && <ItemEditorModal item={editing} open onClose={() => setEditing(null)} />}
    </div>
  );
}
