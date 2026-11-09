import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Eye, Paperclip, Pencil, Trash2 } from 'lucide-react';
import {
  AREA_MAX_LENGTH,
  LEARNING_SOURCE_ROLE_LABELS,
  SOURCE_MEDIA_TYPES,
  SOURCE_PLATFORMS,
  collectAreas,
  normalizeArea,
  normalizeAreas,
  type Entry,
  type SourceMediaType,
  type SourcePlatform,
} from '@larvis/shared';
import { deleteEntry, listTags, upsertEntry } from '../../lib/api';
import { useAutosave } from '../../lib/useAutosave';
import { useToast } from '../../lib/toast';
import { DatePicker } from '../../components/DateTimePicker';
import { Drawer } from '../../components/Drawer';
import { Markdown } from '../../components/Markdown';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { TagInput } from '../../components/TagInput';
import { Badge, Button, GrowingInput, KeyValueList, SaveStatus, TextInput } from '../../components/ui';
import {
  AreaIcon,
  MEDIA_TYPE_LABELS,
  PLATFORM_LABELS,
  formatLength,
  guessPlatform,
  linkHref,
  type EntryLearningLink,
} from './entryMeta';
import { formatBytes, openUpload } from '../notes/attachmentUtil';

interface Props {
  entry: Entry | null;
  open: boolean;
  onClose: () => void;
  /** Vorbelegter Bereich für einen neuen Eintrag (der gerade gefilterte), sonst leer. */
  defaultArea?: string;
  /** Weitere Einträge mit derselben Quelle (gleiche url oder dieselbe hochgeladene Datei), zum Durchwechseln. */
  siblings: Entry[];
  onOpenSibling?: (e: Entry) => void;
  /** Die Liste der Elternansicht, aus der die vorhandenen Bereiche und Kategorien kommen. */
  entries: Entry[];
  /** Die Learnings, in die der Eintrag einfließt; kommt fertig aus der Liste, der Editor lädt nichts nach. */
  learnings?: EntryLearningLink[];
}

// Die Oberfläche zeigt Zahlen selbst als „1.200“, also muss diese Schreibweise auch zurück durchs Feld gehen.
const toInt = (v: string): number | null => {
  const n = Number.parseInt(v.replace(/[.\s]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
};

export function EntryEditorModal({ entry, open, onClose, defaultArea = '', siblings, onOpenSibling, entries, learnings = [] }: Props) {
  const { saved } = useToast();
  const [area, setArea] = useState(entry?.area ?? defaultArea);
  const [alsoAreas, setAlsoAreas] = useState<string[]>(entry?.also_areas ?? []);
  const [name, setName] = useState(entry?.name ?? '');
  const [url, setUrl] = useState(entry?.url ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [category, setCategory] = useState(entry?.category ?? '');
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  const [comment, setComment] = useState(entry?.comment ?? '');
  const [notes, setNotes] = useState(entry?.notes_md ?? '');
  const [preview, setPreview] = useState(Boolean(entry?.notes_md));
  // Quelle
  const [platform, setPlatform] = useState<SourcePlatform | ''>(entry?.source_platform ?? '');
  const [mediaType, setMediaType] = useState<SourceMediaType | ''>(entry?.source_media_type ?? '');
  const [author, setAuthor] = useState(entry?.source_author ?? '');
  const [handle, setHandle] = useState(entry?.source_author_handle ?? '');
  const [title, setTitle] = useState(entry?.source_title ?? '');
  const [publishedAt, setPublishedAt] = useState(entry?.source_published_at ?? '');
  const [duration, setDuration] = useState(entry?.source_duration_seconds?.toString() ?? '');
  const [wordCount, setWordCount] = useState(entry?.source_word_count?.toString() ?? '');
  const [pageCount, setPageCount] = useState(entry?.source_page_count?.toString() ?? '');
  const idRef = useRef(entry?.id ?? null);

  const [knownTags, setKnownTags] = useState<string[]>([]);
  useEffect(() => {
    listTags().then(setKnownTags).catch(() => setKnownTags([]));
  }, []);
  // Bereiche sind frei vergeben; die vorhandenen stehen als Vorschläge bereit, damit derselbe
  // Bereich nicht in zwei Schreibweisen entsteht.
  const areaNorm = normalizeArea(area);
  const knownAreas = collectAreas(entries).map((a) => a.area);
  const areaSuggestions = knownAreas.filter((a) => a !== areaNorm && (!areaNorm || a.includes(areaNorm))).slice(0, 12);
  const knownCategories = [
    ...new Set(entries.filter((e) => e.area === areaNorm && e.category).map((e) => e.category as string)),
  ];

  const { state } = useAutosave({
    value: { area, alsoAreas, name, url, description, category, tags, comment, notes, platform, mediaType, author, handle, title, publishedAt, duration, wordCount, pageCount },
    canSave: () => Boolean(name.trim() && normalizeArea(area)),
    onSaved: saved,
    onSave: async () => {
      const created = await upsertEntry({
        ...(idRef.current ? { id: idRef.current } : {}),
        area: normalizeArea(area),
        also_areas: normalizeAreas(alsoAreas, area),
        name: name.trim(),
        url: url.trim() || null,
        description: description.trim(),
        category: category.trim() || null,
        tags,
        comment: comment.trim(),
        notes_md: notes,
        source_platform: platform || null,
        source_media_type: mediaType || null,
        source_author: author.trim() || null,
        source_author_handle: handle.trim() || null,
        source_title: title.trim() || null,
        source_published_at: publishedAt.trim() || null,
        source_duration_seconds: toInt(duration),
        source_word_count: toInt(wordCount),
        source_page_count: toInt(pageCount),
      });
      idRef.current = created.id;
    },
  });

  async function remove() {
    if (entry) await deleteEntry(entry.id);
    onClose();
  }

  const href = linkHref(url);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={entry ? 'Eintrag bearbeiten' : areaNorm ? `Neu in ${areaNorm}` : 'Neuer Eintrag'}
      footer={
        <>
          {entry && (
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
        {/* Bereich: frei vergebener Text, Vorschläge aus den vorhandenen Bereichen. */}
        <div className="entry-area-pick">
          <AreaIcon size={16} aria-hidden />
          <TextInput
            placeholder="Bereich (z. B. kochen)"
            aria-label="Bereich"
            maxLength={AREA_MAX_LENGTH}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            onBlur={() => setArea(normalizeArea(area))}
          />
        </div>
        {areaSuggestions.length > 0 && (
          <div className="row wrap gap-xs">
            {areaSuggestions.map((a) => (
              <button
                type="button"
                key={a}
                className="chip"
                onClick={() => {
                  setArea(a);
                  setAlsoAreas((cur) => cur.filter((x) => x !== a));
                  setCategory('');
                }}
              >
                {a}
              </button>
            ))}
          </div>
        )}
        {!areaNorm && (
          <div className="muted entry-meta">
            {knownAreas.length === 0 ? 'Noch keine Bereiche — vergib hier den ersten, damit der Eintrag gespeichert wird.' : 'Ohne Bereich wird nicht gespeichert.'}
          </div>
        )}
        {/* Weitere Bereiche: der Eintrag erscheint auch dort, statt doppelt angelegt zu werden. */}
        <div className="section-title" style={{ marginBottom: 0 }}>Auch in</div>
        <TagInput
          value={alsoAreas}
          onChange={(next) => setAlsoAreas(normalizeAreas(next, area))}
          suggestions={knownAreas.filter((a) => a !== areaNorm)}
          placeholder="Weiterer Bereich, Enter…"
        />
        <TextInput placeholder="Titel (kurz, kein Satz)" value={name} onChange={(e) => setName(e.target.value)} />
        {/* Das Feld bleibt editierbar; der Button daneben öffnet die Quelle, sobald sie ein Link ist. */}
        <div className="quick-add">
          <TextInput
            placeholder="URL / Quelle (optional)"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              if (!platform && url.trim()) {
                const guessed = guessPlatform(url.trim());
                if (guessed) setPlatform(guessed);
              }
            }}
          />
          {href && (
            <a className="icon-btn" href={href} target="_blank" rel="noreferrer" aria-label="Link in neuem Tab öffnen" title="Link in neuem Tab öffnen">
              <ExternalLink size={18} />
            </a>
          )}
        </div>
        {entry?.upload && (
          <div className="row center gap-xs entry-meta" style={{ fontSize: 13 }}>
            <Paperclip size={14} />
            <span>
              {entry.upload.filename} · {formatBytes(entry.upload.size_bytes)}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => void openUpload(entry.upload!)}>
              Öffnen
            </Button>
          </div>
        )}
        <div className="section-title" style={{ marginBottom: 0 }}>Warum gespeichert</div>
        <GrowingInput
          placeholder="Deine eigenen Worte: warum du das aufhebst, was daran wichtig ist…"
          aria-label="Warum gespeichert"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <GrowingInput placeholder="Kurzbeschreibung — worum geht's?" value={description} onChange={(e) => setDescription(e.target.value)} />
        <TextInput placeholder="Kategorie (optional, frei)" value={category} onChange={(e) => setCategory(e.target.value)} />
        {knownCategories.length > 0 && (
          <div className="row wrap gap-xs">
            {knownCategories.map((c) => (
              <button type="button" key={c} className="chip" onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <TagInput value={tags} onChange={setTags} suggestions={knownTags} />

        <div className="row between">
          <div className="section-title" style={{ marginBottom: 0 }}>Notizen</div>
          <Button variant="ghost" size="sm" onClick={() => setPreview((p) => !p)} aria-label={preview ? 'Bearbeiten' : 'Vorschau'}>
            {preview ? <Pencil size={14} /> : <Eye size={14} />} {preview ? 'Bearbeiten' : 'Vorschau'}
          </Button>
        </div>
        {preview && notes.trim() ? (
          <Markdown>{notes}</Markdown>
        ) : (
          <MarkdownEditor value={notes} onChange={setNotes} placeholder="Was gezeigt wird, wie es gemacht ist, warum es aufgehoben wurde…" />
        )}

        <div className="section-title" style={{ marginBottom: 0 }}>Quelle</div>
        <div className="source-grid">
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value as SourcePlatform | '')}>
            <option value="">Plattform…</option>
            {SOURCE_PLATFORMS.map((p) => (
              <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
            ))}
          </select>
          <select className="input" value={mediaType} onChange={(e) => setMediaType(e.target.value as SourceMediaType | '')}>
            <option value="">Medientyp…</option>
            {SOURCE_MEDIA_TYPES.map((m) => (
              <option key={m} value={m}>{MEDIA_TYPE_LABELS[m]}</option>
            ))}
          </select>
          <TextInput placeholder="Autor / Creator" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <TextInput placeholder="Handle (ohne @)" value={handle} onChange={(e) => setHandle(e.target.value)} />
          <TextInput placeholder="Originaltitel" value={title} onChange={(e) => setTitle(e.target.value)} />
          <DatePicker value={publishedAt} onChange={setPublishedAt} placeholder="Veröffentlicht" />
          <TextInput placeholder="Dauer in Sekunden" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
          <TextInput placeholder="Wörter" inputMode="numeric" value={wordCount} onChange={(e) => setWordCount(e.target.value)} />
          <TextInput placeholder="Seiten" inputMode="numeric" value={pageCount} onChange={(e) => setPageCount(e.target.value)} />
        </div>
        <KeyValueList
          items={[
            {
              label: 'Länge',
              value: formatLength({ source_duration_seconds: toInt(duration), source_word_count: toInt(wordCount), source_page_count: toInt(pageCount) }),
            },
          ]}
        />

        {/* Umgekehrt gelesene Belege: welche Wiki-Seiten sich auf diesen Eintrag stützen. */}
        {learnings.length > 0 && (
          <>
            <div className="section-title" style={{ marginBottom: 0 }}>Fließt ein in</div>
            <div className="list entry-learnings">
              {learnings.map(({ source, learning }) => (
                <Link key={source.id} to={`/learnings/${learning.slug}`} className="item-row" onClick={onClose}>
                  <div className="item-row__main">
                    <div className="item-row__title">→ {learning.title}</div>
                    {source.comment.trim() && <div className="item-row__sub">{source.comment}</div>}
                  </div>
                  <Badge>{LEARNING_SOURCE_ROLE_LABELS[source.role]}</Badge>
                </Link>
              ))}
            </div>
          </>
        )}

        {siblings.length > 0 && (
          <>
            <div className="section-title" style={{ marginBottom: 0 }}>Weitere Einträge zu dieser Quelle</div>
            <div className="list">
              {siblings.map((s) => (
                <button key={s.id} type="button" className="item-row" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => onOpenSibling?.(s)}>
                  <div className="icon-tile icon-tile--sm">
                    <AreaIcon size={14} />
                  </div>
                  <div className="item-row__main">
                    <div className="item-row__title">{s.name}</div>
                    <div className="item-row__sub">{s.area}{s.category ? ` · ${s.category}` : ''}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
