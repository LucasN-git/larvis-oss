import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, NotebookPen, Pencil, Plus, X, type LucideIcon } from 'lucide-react';
import {
  AREA_MAX_LENGTH,
  LEARNING_SLUG_RE,
  LEARNING_SOURCE_ROLES,
  LEARNING_SOURCE_ROLE_LABELS,
  buildTree,
  collectAreas,
  descendantIds,
  flattenTree,
  normalizeArea,
  removeInlineImage,
  setInlineImageWidth,
  slugify,
  type Learning,
  type LearningAttachment,
  type LearningSourceRole,
  type Entry,
  type Note,
} from '@larvis/shared';
import {
  createLearning,
  deleteLearningAttachment,
  linkLearningSource,
  listLearningAttachments,
  signedLearningFileUrl,
  unlinkLearningSource,
  updateLearning,
  updateLearningSource,
  uploadLearningAttachment,
} from '../../lib/api';
import { useAutosave } from '../../lib/useAutosave';
import { useToast } from '../../lib/toast';
import { Drawer } from '../../components/Drawer';
import { Markdown } from '../../components/Markdown';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { TagInput } from '../../components/TagInput';
import { Button, IconButton, SaveStatus, TextInput } from '../../components/ui';
import { NoteAttachments } from '../notes/NoteAttachments';
import { useLearningRenderers } from './learningMarkdown';
import { type ResolvedSource } from './learningsMeta';
import { AreaIcon } from '../entries/entryMeta';

interface Props {
  learning: Learning | null; // null = neue Seite
  open: boolean;
  onClose: () => void;
  defaults?: { area?: string; parent_id?: string | null };
  /** Alle Live-Seiten — für die Ordner-Auswahl und die Tag-Vorschläge. */
  pages: Learning[];
  /** Alle Belege aller Seiten (mit Quelle verbunden); der Editor zeigt die der eigenen Seite. */
  sources: ResolvedSource[];
  /** Live-Einträge und -Notizen — der Vorrat, aus dem die Beleg-Suche schöpft. */
  entries: Entry[];
  notes: Note[];
  /** Nach dem Lazy-Create (erstes Speichern / erster Upload): die Route springt zur neuen Seite. */
  onCreated?: (created: Learning) => void;
}

const resolveLearningUrl = (att: LearningAttachment) => signedLearningFileUrl(att.storage_path);

/** Postgres-Fehler in einen Satz übersetzen, den das Formular zeigen kann. */
function friendlyError(e: unknown): string {
  // Supabase liefert PostgrestError-Objekte, die keine Error-Instanz sind.
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/learnings_slug_key|duplicate key/i.test(msg)) return 'Dieser Slug ist schon vergeben.';
  if (/learnings_slug_check/i.test(msg)) return 'Slug: nur a-z, 0-9 und einzelne Bindestriche.';
  return msg;
}

// Editor einer Wiki-Seite (Drawer, Autosave). Der Slug wird aus dem Titel vorgeschlagen und
// ist bis zum Anlegen editierbar — danach ist er die feste Adresse. Die Seite entsteht beim
// ersten gültigen Speichern oder beim ersten Bild-Upload (Lazy-Create wie bei Notizen).
export function LearningEditor({ learning, open, onClose, defaults = {}, pages, sources, entries, notes, onCreated }: Props) {
  const { saved } = useToast();
  const [title, setTitle] = useState(learning?.title ?? '');
  const [slug, setSlug] = useState(learning?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(learning));
  const [locked, setLocked] = useState(Boolean(learning));
  const [areaInput, setArea] = useState(learning?.area ?? defaults.area ?? '');
  // Bereiche sind frei vergebener Text; gespeichert und verglichen wird die normalisierte Form.
  const area = normalizeArea(areaInput);
  const [parentId, setParentId] = useState<string | null>(learning?.parent_id ?? defaults.parent_id ?? null);
  const [summary, setSummary] = useState(learning?.summary ?? '');
  const [body, setBody] = useState(learning?.body_md ?? '');
  const [tags, setTags] = useState<string[]>(learning?.tags ?? []);
  const [preview, setPreview] = useState(Boolean(learning?.body_md));
  const [attachments, setAttachments] = useState<LearningAttachment[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const idRef = useRef(learning?.id ?? null);
  // Spiegel von idRef als State, damit die Beleg-Liste nach dem Lazy-Create neu rendert.
  const [pageId, setPageId] = useState<string | null>(learning?.id ?? null);

  // Aktuelle Werte für den asynchronen Create-Pfad (keine veralteten Closures).
  const stateRef = useRef({ title, slug, area, parentId, summary, body, tags });
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  // Slug-Vorschlag aus dem Titel, solange die Seite neu ist und niemand den Slug angefasst hat.
  useEffect(() => {
    if (slugTouched || locked) return;
    setSlug(title.trim() ? slugify(title).replace(/-+$/, '') : '');
  }, [title, slugTouched, locked]);

  useEffect(() => {
    if (learning?.id) listLearningAttachments(learning.id).then(setAttachments).catch(() => {});
  }, [learning?.id]);

  const knownTags = useMemo(() => [...new Set(pages.flatMap((p) => p.tags))].sort(), [pages]);
  // Vorhandene Bereiche aus Wiki und Inbox als Vorschläge, damit keine zweite Schreibweise entsteht.
  const knownAreas = useMemo(() => collectAreas([...pages, ...entries]).map((a) => a.area), [pages, entries]);
  const areaSuggestions = knownAreas.filter((a) => a !== area && (!area || a.includes(area))).slice(0, 12);

  // Mögliche Elternseiten: gleicher Bereich, ohne sich selbst und die eigenen Nachfahren.
  const parentOptions = useMemo(() => {
    const inArea = pages.filter((p) => p.area === area);
    const blocked = idRef.current ? descendantIds(pages, idRef.current) : new Set<string>();
    return flattenTree(buildTree(inArea))
      .filter(({ node }) => node.id !== idRef.current && !blocked.has(node.id))
      .map(({ node, depth }) => ({ id: node.id, label: `${'  '.repeat(depth)}${node.title}` }));
  }, [pages, area]);

  const effectiveParent = parentId && parentOptions.some((o) => o.id === parentId) ? parentId : null;
  stateRef.current = { title, slug, area, parentId: effectiveParent, summary, body, tags };

  const slugValid = LEARNING_SLUG_RE.test(slug);

  // Seite bei Bedarf anlegen; ein geteiltes Promise lässt parallele Aufrufer (Paste +
  // Autosave) einen Create nutzen. Scheitert er (z. B. Slug vergeben), darf es der
  // nächste Versuch neu probieren.
  const creatingRef = useRef<Promise<string> | null>(null);
  const ensureId = useCallback(async (): Promise<string> => {
    if (idRef.current) return idRef.current;
    if (creatingRef.current) return creatingRef.current;
    const p = (async () => {
      const s = stateRef.current;
      const created = await createLearning({
        slug: s.slug,
        area: s.area,
        title: s.title.trim(),
        body_md: s.body,
        summary: s.summary.trim() || null,
        parent_id: s.parentId,
        tags: s.tags,
      });
      idRef.current = created.id;
      setPageId(created.id);
      setSlug(created.slug);
      setLocked(true);
      onCreatedRef.current?.(created);
      return created.id;
    })();
    creatingRef.current = p;
    try {
      return await p;
    } catch (e) {
      creatingRef.current = null;
      throw e;
    }
  }, []);

  const { state } = useAutosave({
    value: { title, slug, area, parentId: effectiveParent, summary, body, tags },
    canSave: () => Boolean(title.trim() && area) && LEARNING_SLUG_RE.test(slug),
    onSaved: () => {
      setSaveError(null);
      saved();
    },
    onSave: async () => {
      try {
        // Neu? Erst anlegen — der Create kann einen älteren Stand tragen (paralleler
        // Upload), deshalb folgt ihm immer das Update mit den aktuellen Werten.
        const id = idRef.current ?? (await ensureId());
        await updateLearning(id, {
          title: title.trim(),
          area,
          parent_id: effectiveParent,
          summary: summary.trim() || null,
          body_md: body,
          tags,
        });
      } catch (e) {
        setSaveError(friendlyError(e));
        throw e;
      }
    },
  });

  const uploadImage = useCallback(
    async (file: File) => {
      try {
        const id = await ensureId();
        const row = await uploadLearningAttachment(id, file, { inline: true });
        setAttachments((prev) => [...prev, row]);
        return { id: row.id, filename: row.filename };
      } catch (e) {
        setSaveError(friendlyError(e));
        return null;
      }
    },
    [ensureId],
  );

  const handleUploadDocs = useCallback(
    async (files: File[]) => {
      try {
        const id = await ensureId();
        for (const f of files) {
          const row = await uploadLearningAttachment(id, f, { inline: false });
          setAttachments((prev) => [...prev, row]);
        }
      } catch (e) {
        setSaveError(friendlyError(e));
      }
    },
    [ensureId],
  );

  const handleDeleteAttachment = useCallback(async (att: LearningAttachment) => {
    try {
      await deleteLearningAttachment(att);
      setAttachments((prev) => prev.filter((a) => a.id !== att.id));
      if (att.inline) setBody((b) => removeInlineImage(b, att.id));
    } catch (e) {
      setSaveError(friendlyError(e));
    }
  }, []);

  const linked = useMemo(() => sources.filter((s) => s.source.learning_id === pageId), [sources, pageId]);

  const linkSource = useCallback(
    async (target: { entry_id: string } | { note_id: string }) => {
      const s = stateRef.current;
      if (!idRef.current && (!s.title.trim() || !LEARNING_SLUG_RE.test(s.slug) || !s.area)) {
        setSaveError(
          !s.title.trim()
            ? 'Erst Titel vergeben, dann Belege verknüpfen.'
            : !s.area
              ? 'Erst einen Bereich vergeben, dann Belege verknüpfen.'
              : 'Erst einen gültigen Slug vergeben, dann Belege verknüpfen.',
        );
        return;
      }
      try {
        const id = await ensureId();
        const role: LearningSourceRole = 'entry_id' in target ? 'beleg' : 'erfahrung';
        await linkLearningSource({ learning_id: id, role, sort_order: linked.length, ...target });
        setSaveError(null);
      } catch (e) {
        setSaveError(friendlyError(e));
      }
    },
    [ensureId, linked.length],
  );

  const patchSource = useCallback(async (id: string, patch: { role?: LearningSourceRole; comment?: string }) => {
    try {
      await updateLearningSource(id, patch);
      setSaveError(null);
    } catch (e) {
      setSaveError(friendlyError(e));
    }
  }, []);

  const removeSource = useCallback(async (id: string) => {
    try {
      await unlinkLearningSource(id);
      setSaveError(null);
    } catch (e) {
      setSaveError(friendlyError(e));
    }
  }, []);

  const onResize = useCallback((id: string, width: number | null) => setBody((b) => setInlineImageWidth(b, id, width)), []);
  const { renderImage, renderLink } = useLearningRenderers(attachments, onResize);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={learning ? 'Seite bearbeiten' : 'Neue Seite'}
      footer={
        <>
          <SaveStatus state={state} />
          <Button variant="primary" onClick={onClose}>
            Fertig
          </Button>
        </>
      }
    >
      <div className="stack gap-sm">
        <div className="wiki__area-pick">
          <AreaIcon size={16} aria-hidden />
          <TextInput
            placeholder="Bereich (z. B. kochen)"
            aria-label="Bereich"
            maxLength={AREA_MAX_LENGTH}
            value={areaInput}
            onChange={(e) => setArea(e.target.value)}
            onBlur={() => setArea(area)}
          />
        </div>
        {areaSuggestions.length > 0 && (
          <div className="row wrap gap-xs">
            {areaSuggestions.map((a) => (
              <button type="button" key={a} className="chip" onClick={() => setArea(a)}>
                {a}
              </button>
            ))}
          </div>
        )}
        {!area && (
          <div className="wiki__hint">
            {knownAreas.length === 0 ? 'Noch keine Bereiche — vergib hier den ersten, damit die Seite gespeichert wird.' : 'Ohne Bereich wird nicht gespeichert.'}
          </div>
        )}
        <TextInput placeholder="Titel" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!learning} />
        <div className="stack gap-xs">
          <TextInput
            placeholder="slug-der-seite"
            value={slug}
            disabled={locked}
            spellCheck={false}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
            }}
          />
          <div className="wiki__hint">
            {locked
              ? `Adresse: /learnings/${slug} — fest, seit die Seite existiert.`
              : slug && !slugValid
                ? 'Nur a-z, 0-9 und einzelne Bindestriche.'
                : 'Wird zur Adresse /learnings/<slug> und bleibt danach fest.'}
          </div>
        </div>
        <div>
          <div className="section-title" style={{ margin: '0 0 8px' }}>Ordner</div>
          <select className="input" value={effectiveParent ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
            <option value="">— Oberste Ebene —</option>
            {parentOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <TextInput placeholder="Teaser — ein Satz, worum es geht" value={summary} onChange={(e) => setSummary(e.target.value)} />

        <div className="row between">
          <div className="section-title" style={{ marginBottom: 0 }}>Inhalt</div>
          <Button variant="ghost" size="sm" onClick={() => setPreview((p) => !p)} aria-label={preview ? 'Bearbeiten' : 'Vorschau'}>
            {preview ? <Pencil size={14} /> : <Eye size={14} />} {preview ? 'Bearbeiten' : 'Vorschau'}
          </Button>
        </div>
        {preview && body.trim() ? (
          <Markdown className="wiki__body" renderImage={renderImage} renderLink={renderLink}>
            {body}
          </Markdown>
        ) : (
          <MarkdownEditor
            value={body}
            onChange={setBody}
            uploadImage={uploadImage}
            placeholder="Kuratiert schreiben: ganze Sätze, aktueller Zustand, ## Überschriften, Grafiken…"
          />
        )}

        <SourcesEditor
          linked={linked}
          entries={entries}
          notes={notes}
          onLink={linkSource}
          onPatch={patchSource}
          onRemove={removeSource}
        />

        <NoteAttachments attachments={attachments} onUpload={handleUploadDocs} onDelete={handleDeleteAttachment} resolveUrl={resolveLearningUrl} />
        <TagInput value={tags} onChange={setTags} suggestions={knownTags} />
        {saveError && <div className="wiki__error">{saveError}</div>}
      </div>
    </Drawer>
  );
}

const MAX_HITS = 8;

/**
 * Belege im Editor: die verknüpften Quellen mit Rolle, Kommentar und Entfernen, darunter
 * eine Suche über Einträge und Notizen. Die Suche läuft clientseitig über die ohnehin
 * geladenen Live-Listen; bereits verknüpfte Quellen erscheinen nicht als Treffer.
 */
function SourcesEditor({
  linked,
  entries,
  notes,
  onLink,
  onPatch,
  onRemove,
}: {
  linked: ResolvedSource[];
  entries: Entry[];
  notes: Note[];
  onLink: (target: { entry_id: string } | { note_id: string }) => Promise<void>;
  onPatch: (id: string, patch: { role?: LearningSourceRole; comment?: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const linkedEntries = new Set(linked.map((l) => l.source.entry_id).filter(Boolean));
    const linkedNotes = new Set(linked.map((l) => l.source.note_id).filter(Boolean));
    const out: { key: string; title: string; sub: string; Icon: LucideIcon; target: { entry_id: string } | { note_id: string } }[] = [];
    for (const e of entries) {
      if (out.length >= MAX_HITS) break;
      if (linkedEntries.has(e.id)) continue;
      const hay = [e.name, e.comment, e.description, ...e.tags].join(' ').toLowerCase();
      if (hay.includes(q)) {
        out.push({ key: `e:${e.id}`, title: e.name, sub: e.description, Icon: AreaIcon, target: { entry_id: e.id } });
      }
    }
    for (const n of notes) {
      if (out.length >= MAX_HITS) break;
      if (linkedNotes.has(n.id)) continue;
      if (n.title.toLowerCase().includes(q)) {
        out.push({ key: `n:${n.id}`, title: n.title || 'Ohne Titel', sub: 'Notiz', Icon: NotebookPen, target: { note_id: n.id } });
      }
    }
    return out;
  }, [query, entries, notes, linked]);

  return (
    <div className="stack gap-xs">
      <div className="section-title" style={{ margin: '8px 0 0' }}>Belege</div>
      {linked.length > 0 && (
        <div className="list">
          {linked.map((l) => {
            const Icon = l.icon;
            return (
              <div key={l.source.id} className="item-row item-row--wrap wiki__source-edit">
                <div className="icon-tile icon-tile--sm">
                  <Icon size={14} />
                </div>
                <div className="item-row__main stack gap-xs">
                  <div className="item-row__title">{l.title}</div>
                  <input
                    key={l.source.comment}
                    className="input wiki__source-comment"
                    placeholder="Was zeigt die Quelle für die Aussage?"
                    defaultValue={l.source.comment}
                    // Escape schließt den Drawer über einen Fenster-Listener ohne Blur; vorher blurren, damit der Kommentar gespeichert wird.
                    onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== l.source.comment) void onPatch(l.source.id, { comment: v });
                    }}
                  />
                </div>
                <div className="item-row__actions">
                  <select
                    className="input wiki__source-role"
                    aria-label="Rolle"
                    value={l.source.role}
                    onChange={(e) => void onPatch(l.source.id, { role: e.target.value as LearningSourceRole })}
                  >
                    {LEARNING_SOURCE_ROLES.map((r) => (
                      <option key={r} value={r}>{LEARNING_SOURCE_ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                  <IconButton variant="bare" size="sm" label="Beleg entfernen" onClick={() => void onRemove(l.source.id)}>
                    <X size={14} />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <TextInput placeholder="Eintrag oder Notiz suchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {query.trim() && (
        hits.length === 0 ? (
          <div className="wiki__hint">Nichts gefunden.</div>
        ) : (
          <div className="list">
            {hits.map((h) => (
              <button
                key={h.key}
                type="button"
                className="item-row wiki__source-hit"
                onClick={() => {
                  void onLink(h.target);
                  setQuery('');
                }}
              >
                <div className="icon-tile icon-tile--sm">
                  <h.Icon size={14} />
                </div>
                <div className="item-row__main">
                  <div className="item-row__title">{h.title}</div>
                  {h.sub && <div className="item-row__sub">{h.sub}</div>}
                </div>
                <Plus size={14} aria-hidden />
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}
