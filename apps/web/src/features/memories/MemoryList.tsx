import { useCallback, useState } from 'react';
import { Brain, Plus } from 'lucide-react';
import { MEMORY_KINDS, MEMORY_KIND_LABELS, type Memory, type MemoryKind } from '@larvis/shared';
import { listMemories } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Button, Chip, Segmented, TextInput } from '../../components/ui';
import { MemoryEditorModal } from './MemoryEditorModal';
import '../../routes/personal.css';

type KindFilter = 'all' | MemoryKind;

/**
 * Persistente Agent-Memories: was Claude über den Nutzer wissen soll. Source of
 * Truth ist Supabase; scripts/memory/sync-claude-md.mjs kann alles in eine
 * CLAUDE.md spiegeln (Agenten lesen dann aus dem Kontext, ohne MCP-Call).
 */
export function MemoryList() {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const fetcher = useCallback(
    () => listMemories(kindFilter === 'all' ? {} : { kind: kindFilter }),
    [kindFilter],
  );
  const { data: memories, loading } = useLiveQuery(fetcher, ['memories'], [kindFilter], `memories:${kindFilter}`);

  const q = query.trim().toLowerCase();
  const filtered = memories?.filter(
    (m) => !q || m.title.toLowerCase().includes(q) || m.content_md.toLowerCase().includes(q) || m.slug.includes(q),
  );

  const [editing, setEditing] = useState<Memory | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack gap-md">
      <Segmented
        options={[
          { value: 'all' as KindFilter, label: 'Alle' },
          ...MEMORY_KINDS.map((k) => ({ value: k as KindFilter, label: MEMORY_KIND_LABELS[k] })),
        ]}
        value={kindFilter}
        onChange={setKindFilter}
      />

      <div className="quick-add">
        <TextInput placeholder="Memories durchsuchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="primary" onClick={() => setCreating(true)} aria-label="Neue Memory">
          <Plus size={18} />
        </Button>
      </div>

      {filtered && (filtered.length > 0 || !loading) && (
        <div className="group group--tile">
          {filtered.length === 0 && !loading && (
            <div className="group__empty">{q ? 'Nichts gefunden.' : 'Noch keine Memories gespeichert.'}</div>
          )}
          {filtered.map((m) => (
            <button key={m.id} className="item-row" style={{ textAlign: 'left' }} onClick={() => setEditing(m)}>
              <div className="icon-tile icon-tile--sm">
                <Brain size={14} />
              </div>
              <div className="item-row__main">
                <div className="item-row__title">{m.title}</div>
                <div className="item-row__sub">{m.content_md.split('\n')[0] || m.slug}</div>
              </div>
              {m.scope && <Chip>{m.scope}</Chip>}
              {kindFilter === 'all' && <Chip>{MEMORY_KIND_LABELS[m.kind]}</Chip>}
            </button>
          ))}
        </div>
      )}

      <div className="muted" style={{ fontSize: 13 }}>
        Lässt sich per <code>npm run memory:sync</code> in eine CLAUDE.md spiegeln — dort kosten Inhalte Kontext in
        jeder Session, also kurz halten.
      </div>

      {creating && (
        <MemoryEditorModal
          memory={null}
          open
          onClose={() => setCreating(false)}
          defaultKind={kindFilter === 'all' ? 'user' : kindFilter}
        />
      )}
      {editing && <MemoryEditorModal memory={editing} open onClose={() => setEditing(null)} />}
    </div>
  );
}
