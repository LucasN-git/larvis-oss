import { useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import type { Place } from '@larvis/shared';
import { listPlaces } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Button, Chip, TextInput } from '../../components/ui';
import { PlaceEditorModal } from './PlaceEditorModal';

const fetchPlaces = () => listPlaces();

export function PlacesList() {
  const [query, setQuery] = useState('');
  const { data: places, loading, error } = useLiveQuery(fetchPlaces, ['places'], [], 'places');
  const [editing, setEditing] = useState<Place | null>(null);
  const [creating, setCreating] = useState(false);

  const q = query.trim().toLowerCase();
  const rows = (places ?? []).filter(
    (p) => !q || [p.name, p.city, ...p.aliases].some((s) => s.toLowerCase().includes(q)),
  );

  return (
    <div className="stack gap-md">
      <div className="quick-add">
        <TextInput placeholder="Orte durchsuchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="primary" onClick={() => setCreating(true)} aria-label="Neuer Ort">
          <Plus size={18} />
        </Button>
      </div>

      {error && !places && <div className="empty">Orte konnten nicht geladen werden.</div>}

      {places && rows.length === 0 && !loading && (
        <div className="empty">{q ? 'Nichts gefunden.' : 'Noch keine Orte.'}</div>
      )}

      {rows.length > 0 && (
        <div className="group group--tile">
          {rows.map((p) => {
            const sub = [p.city, p.address].filter(Boolean).join(' · ');
            return (
              <button key={p.id} className="item-row" style={{ textAlign: 'left' }} onClick={() => setEditing(p)}>
                <div className="icon-tile icon-tile--sm">
                  <MapPin size={14} />
                </div>
                <div className="item-row__main">
                  <div className="item-row__title">{p.name}</div>
                  {sub && <div className="item-row__sub">{sub}</div>}
                </div>
                {p.travel_minutes != null && <Chip>{p.travel_minutes} min</Chip>}
              </button>
            );
          })}
        </div>
      )}

      {creating && <PlaceEditorModal place={null} open onClose={() => setCreating(false)} />}
      {editing && <PlaceEditorModal place={editing} open onClose={() => setEditing(null)} />}
    </div>
  );
}
