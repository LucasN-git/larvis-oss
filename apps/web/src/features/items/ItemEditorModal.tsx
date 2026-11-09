import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Area, Item } from '@larvis/shared';
import { deleteItem, upsertItem } from '../../lib/api';
import { useAutosave } from '../../lib/useAutosave';
import { useToast } from '../../lib/toast';
import { Drawer } from '../../components/Drawer';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { Button, SaveStatus, TextInput } from '../../components/ui';

interface Props {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  defaultArea?: Area;
  defaultProjectId?: string | null;
}

export function ItemEditorModal({ item, open, onClose, defaultArea = 'personal', defaultProjectId = null }: Props) {
  const { saved } = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [notes, setNotes] = useState(item?.notes_md ?? '');
  const idRef = useRef(item?.id ?? null);

  const { state } = useAutosave({
    value: { name, location, category, notes },
    canSave: () => Boolean(name.trim()),
    onSaved: saved,
    onSave: async () => {
      const created = await upsertItem({
        ...(idRef.current ? { id: idRef.current } : {}),
        name: name.trim(),
        location: location.trim(),
        category: category.trim() || null,
        notes_md: notes,
        area: item?.area ?? defaultArea,
        project_id: item?.project_id ?? defaultProjectId,
      });
      idRef.current = created.id;
    },
  });

  async function remove() {
    if (item) await deleteItem(item.id);
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={item ? 'Ding bearbeiten' : 'Neues Ding'}
      footer={
        <>
          {item && (
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
        <TextInput placeholder="Was? (z. B. Reisepass)" value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput
          placeholder="Wo? (z. B. Kiste im Keller)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <TextInput placeholder="Kategorie (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
        <MarkdownEditor value={notes} onChange={setNotes} placeholder="Notizen (optional)…" />
      </div>
    </Drawer>
  );
}
