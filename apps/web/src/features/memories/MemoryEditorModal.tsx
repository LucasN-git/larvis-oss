import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { MEMORY_KINDS, MEMORY_KIND_LABELS, slugify, type Memory, type MemoryKind } from '@larvis/shared';
import { deleteMemory, upsertMemory } from '../../lib/api';
import { useAutosave } from '../../lib/useAutosave';
import { useToast } from '../../lib/toast';
import { Drawer } from '../../components/Drawer';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { Button, SaveStatus, Segmented, TextInput } from '../../components/ui';

interface Props {
  memory: Memory | null;
  open: boolean;
  onClose: () => void;
  defaultKind?: MemoryKind;
}

export function MemoryEditorModal({ memory, open, onClose, defaultKind = 'user' }: Props) {
  const { saved } = useToast();
  const [kind, setKind] = useState<MemoryKind>(memory?.kind ?? defaultKind);
  const [title, setTitle] = useState(memory?.title ?? '');
  const [slugInput, setSlugInput] = useState(memory?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(false);
  const [scope, setScope] = useState(memory?.scope ?? '');
  const [content, setContent] = useState(memory?.content_md ?? '');
  // Nach dem ersten Save ist der Slug eingefroren: er ist der Upsert-Key, ein
  // weiter mitlaufender Auto-Slug würde bei jedem Autosave neue Zeilen anlegen.
  const frozenSlugRef = useRef<string | null>(memory?.slug ?? null);

  const slug = frozenSlugRef.current ?? (slugTouched ? slugify(slugInput) : slugify(title));

  const { state } = useAutosave({
    value: { kind, title, slug, scope, content },
    canSave: () => Boolean(title.trim() && slug),
    onSaved: saved,
    onSave: async () => {
      await upsertMemory({
        slug,
        title: title.trim(),
        content_md: content,
        kind,
        scope: scope.trim() || null,
      });
      frozenSlugRef.current = slug;
    },
  });

  async function remove() {
    if (memory) await deleteMemory(memory.id);
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={memory ? 'Memory bearbeiten' : 'Neue Memory'}
      footer={
        <>
          {memory && (
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
        <Segmented
          options={MEMORY_KINDS.map((k) => ({ value: k, label: MEMORY_KIND_LABELS[k] }))}
          value={kind}
          onChange={setKind}
        />
        <TextInput
          placeholder="Titel (ein Fakt pro Memory)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextInput
          placeholder="Slug (auto aus dem Titel)"
          value={frozenSlugRef.current ?? (slugTouched ? slugInput : slug)}
          disabled={frozenSlugRef.current !== null}
          onChange={(e) => {
            setSlugTouched(true);
            setSlugInput(e.target.value);
          }}
          style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}
        />
        <TextInput
          placeholder="Scope (optional, z. B. larvis — leer = global)"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        />
        <MarkdownEditor
          value={content}
          onChange={setContent}
          placeholder="Inhalt — kurz halten, landet in jedem Agenten-Kontext…"
        />
      </div>
    </Drawer>
  );
}
