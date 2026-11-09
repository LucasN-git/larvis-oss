import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Place } from '@larvis/shared';
import { deletePlace, restorePlace, upsertPlace } from '../../lib/api';
import { useAutosave } from '../../lib/useAutosave';
import { useToast } from '../../lib/toast';
import { Drawer } from '../../components/Drawer';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { TagInput } from '../../components/TagInput';
import { Button, SaveStatus, TextInput } from '../../components/ui';
import { HOME_PLACE } from '../../lib/modules';

interface Props {
  place: Place | null;
  open: boolean;
  onClose: () => void;
}

/** Leeres Feld = unbekannt/innerorts (null); sonst ganze, nicht-negative Minuten. */
function parseMinutes(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function PlaceEditorModal({ place, open, onClose }: Props) {
  const { saved, notify } = useToast();
  const [name, setName] = useState(place?.name ?? '');
  const [address, setAddress] = useState(place?.address ?? '');
  const [city, setCity] = useState(place?.city ?? '');
  const [minutes, setMinutes] = useState(place?.travel_minutes != null ? String(place.travel_minutes) : '');
  const [aliases, setAliases] = useState<string[]>(place?.aliases ?? []);
  const [notes, setNotes] = useState(place?.notes_md ?? '');
  const idRef = useRef(place?.id ?? null);

  const { state } = useAutosave({
    value: { name, address, city, minutes, aliases, notes },
    canSave: () => Boolean(name.trim()),
    onSaved: saved,
    onSave: async () => {
      try {
        const row = await upsertPlace({
          ...(idRef.current ? { id: idRef.current } : {}),
          name: name.trim(),
          address: address.trim(),
          city: city.trim(),
          travel_minutes: parseMinutes(minutes),
          aliases,
          notes_md: notes,
        });
        idRef.current = row.id;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') notify(`„${name.trim()}“ gibt es schon`, 'error');
        throw e;
      }
    },
  });

  async function remove() {
    const id = idRef.current;
    if (!id) return onClose();
    await deletePlace(id);
    onClose();
    notify(`„${name.trim() || 'Ort'}“ gelöscht`, 'info', {
      action: {
        label: 'Rückgängig',
        onClick: () => void restorePlace(id).catch(() => notify('Wiederherstellen fehlgeschlagen', 'error')),
      },
    });
  }

  const label = { fontSize: 12, fontWeight: 600 } as const;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={place ? 'Ort bearbeiten' : 'Neuer Ort'}
      footer={
        <>
          {place && (
            <Button variant="ghost" onClick={remove} style={{ color: 'var(--danger)', marginRight: 'auto' }}>
              <Trash2 size={16} /> Löschen
            </Button>
          )}
          <SaveStatus state={state} />
          <Button variant="primary" onClick={onClose}>
            Fertig
          </Button>
        </>
      }
    >
      <div className="stack gap-sm">
        <TextInput placeholder="Name (z. B. Büro)" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!place} />
        <TextInput placeholder="Adresse" value={address} onChange={(e) => setAddress(e.target.value)} />
        <TextInput placeholder="Stadt" value={city} onChange={(e) => setCity(e.target.value)} />

        <div className="muted" style={label}>Fahrzeit ab {HOME_PLACE ?? 'Heimatort'} (Auto)</div>
        <div className="row gap-sm center">
          <TextInput
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="unbekannt"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            style={{ maxWidth: 140 }}
          />
          <span className="muted" style={{ fontSize: 13 }}>Minuten · leer = unbekannt oder innerorts</span>
        </div>

        <div className="muted" style={label}>Aliase</div>
        <TagInput value={aliases} onChange={setAliases} placeholder="Alias tippen, Enter…" />
        <div className="muted" style={{ fontSize: 12 }}>
          Weitere Namen, unter denen ein Termin-Ort diesem Ort zugeordnet wird.
        </div>

        <div className="muted" style={label}>Notizen</div>
        <MarkdownEditor value={notes} onChange={setNotes} placeholder="Anfahrt, Parken, Eingang…" />
      </div>
    </Drawer>
  );
}
