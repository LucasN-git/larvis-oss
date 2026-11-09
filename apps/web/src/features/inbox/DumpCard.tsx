import { useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Paperclip, Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { InboxItem } from '@larvis/shared';
import { addInboxItem, deleteInboxItem, listInbox, resolveInboxItem, uploadInboxFile } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { formatRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { IconButton, TextInput } from '../../components/ui';
import { attachmentIcon, formatBytes, openUpload } from '../notes/attachmentUtil';

// Quick-capture "dump": Text, Links und Dateien schnell reinwerfen; Claude ordnet sie
// später als Einträge ein. Eingeklappt zeigt die Gruppe fünf Zeilen. Der Punkt vor
// einer Zeile heißt „noch nicht gescannt", die Unterzeile trägt Claudes Scan-Notiz.
// Eine Datei ergibt ein Item; getippter Text wird zum Präfix vor dem Dateinamen.
// Sobald etwas eingegeben ist, erscheint ein zweites Feld für den eigenen Kommentar (warum
// er es aufhebt); er hängt als note am Item und wird unter dem Inhalt angezeigt.
const COLLAPSED_ROWS = 5;

const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

export function DumpCard() {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [over, setOver] = useState(false);
  // dragenter/dragleave feuern auch beim Wechsel zwischen Kind-Elementen; der Zähler
  // hält das Highlight stabil, bis der Zeiger die Karte wirklich verlässt.
  const depth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const { notify } = useToast();
  // Cache-Key v3: die Zeilen tragen seit dem Kommentar (note) mehr Felder.
  const { data: items } = useLiveQuery(() => listInbox(false), ['inbox'], [], 'inbox:open:v3');

  const total = items?.length ?? 0;
  const visible = expanded ? items : items?.slice(0, COLLAPSED_ROWS);
  const hidden = total - (visible?.length ?? 0);

  function addFiles(files: File[]) {
    if (files.length > 0) setPending((p) => [...p, ...files]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t && pending.length === 0) return;
    const batch = pending;
    const n = note;
    // Nur leeren, was seit dem Absenden nicht weiter getippt wurde.
    const clear = () => {
      setText((cur) => (cur === text ? '' : cur));
      setNote((cur) => (cur === n ? '' : cur));
    };
    setBusy(true);
    try {
      if (batch.length === 0) {
        await addInboxItem(t, n);
        clear();
        return;
      }
      // Fehlgeschlagene Dateien bleiben als Chips stehen — erneutes Senden ist der Retry.
      const failed: File[] = [];
      for (const f of batch) {
        const content = t ? `${t} — ${f.name}` : f.name;
        try {
          await uploadInboxFile(f, content, n);
        } catch (err) {
          failed.push(f);
          notify(err instanceof Error ? err.message : `${f.name}: Upload fehlgeschlagen.`, 'error');
        }
      }
      setPending((p) => [...failed, ...p.filter((f) => !batch.includes(f))]);
      if (failed.length === 0) clear();
    } catch (err) {
      // Nur addInboxItem kann hier landen — die Upload-Schleife fängt pro Datei selbst.
      notify(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const toggle = () => setExpanded((v) => !v);

  // Kopf außerhalb des Rahmens, darunter eine Gruppe: Eingabe als erste Zeile,
  // Kommentar und Datei-Chips als weitere Zeilen, dann die Items. Die ganze
  // Sektion ist Ablagefläche für Dateien; der Rahmen färbt sich beim Ziehen.
  return (
    <section
      className="dump"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setOver(false);
        }
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div
        className="section-title dump__title"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Dump</span>
        <span style={{ fontWeight: 400 }}>({total})</span>
      </div>

      <div className={clsx('group dump-card', over && 'dump-card--over')}>
        <form onSubmit={submit} className="group__add dump__add">
          <TextInput
            placeholder="Schnell reinwerfen — Text, Link oder Datei …"
            aria-label="In den Dump"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length > 0) {
                e.preventDefault();
                addFiles(files);
              }
            }}
          />
          <IconButton
            type="button"
            variant="bare"
            label="Datei anhängen"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={18} />
          </IconButton>
          <IconButton type="submit" variant="bare" className="text-accent" label="Rein damit" disabled={busy}>
            <Plus size={20} />
          </IconButton>
          {/* Kein accept: auf iOS würden sonst Foto- und Datei-Quellen fehlen. */}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </form>
        {/* Eigenes Formular je Zeile, damit Enter auch im Kommentar absendet und
            die Zeilen direkte Kinder der Gruppe bleiben (Trenner). */}
        {(text.trim() || pending.length > 0 || note) && (
          <form onSubmit={submit} className="group__add dump__add">
            <TextInput
              placeholder="Warum speicherst du das? (optional)"
              aria-label="Kommentar"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </form>
        )}
        {pending.length > 0 && (
          <div className="dump__pending row wrap gap-xs">
            {pending.map((f, i) => (
              <button
                type="button"
                key={`${f.name}-${f.size}-${i}`}
                className="chip chip--removable"
                title="Entfernen"
                onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
              >
                {f.name} · {formatBytes(f.size)} ✕
              </button>
            ))}
            {busy && (
              <span className="text-muted" style={{ fontSize: 12 }}>
                Lädt…
              </span>
            )}
          </div>
        )}

        {visible?.map((it) => (
          <DumpRow key={it.id} item={it} />
        ))}

        {!expanded && hidden > 0 && (
          <button type="button" className="group__foot" onClick={() => setExpanded(true)}>
            <span>Mehr anzeigen ({hidden})</span>
            <ChevronDown size={15} />
          </button>
        )}
      </div>
    </section>
  );
}

function DumpRow({ item }: { item: InboxItem }) {
  const upload = item.upload ?? null;
  const FileIcon = upload ? attachmentIcon(upload) : null;
  return (
    <div className="item-row item-row--compact">
      {/* Immer gerendert, damit gescannte und ungescannte Titel bündig bleiben. */}
      <span
        className="dump-dot"
        style={item.scanned_at ? { visibility: 'hidden' } : undefined}
        title={item.scanned_at ? undefined : 'Noch nicht gescannt'}
      />
      <div className="item-row__main">
        <div className="item-row__title" title={item.content}>
          {item.content}
        </div>
        {item.note && (
          <div className="dump-note" title={item.note}>
            „{item.note}“
          </div>
        )}
        <div className="item-row__sub">
          <span>{formatRelative(item.created_at)}</span>
          {upload && FileIcon && (
            <button
              type="button"
              className="dump-file"
              title={`${upload.filename} · ${formatBytes(upload.size_bytes)}`}
              onClick={() => void openUpload(upload)}
            >
              <FileIcon size={12} />
              <span>{upload.filename}</span>
            </button>
          )}
          {item.scan_note && <span title={item.scan_note}>· {item.scan_note}</span>}
        </div>
      </div>
      <IconButton size="sm" variant="bare" label="Erledigt" onClick={() => resolveInboxItem(item.id)}>
        <Check size={15} />
      </IconButton>
      <IconButton size="sm" variant="bare" label="Löschen" onClick={() => deleteInboxItem(item.id)}>
        <Trash2 size={15} />
      </IconButton>
    </div>
  );
}
