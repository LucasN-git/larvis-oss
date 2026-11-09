import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { FileText, Plus } from 'lucide-react';
import { buildTree, collectAreas, type Entry, type Learning, type Note } from '@larvis/shared';
import {
  deleteLearning,
  listArchivedNotes,
  listEntries,
  listLearningAttachments,
  listLearningSources,
  listLearnings,
  listNotes,
} from '../lib/api';
import { useLiveQuery } from '../lib/useLive';
import { Button } from '../components/ui';
import { LearningsNav } from '../features/learnings/LearningsNav';
import { LearningPage } from '../features/learnings/LearningPage';
import { LearningEditor } from '../features/learnings/LearningEditor';
import { areaHref, resolveSources } from '../features/learnings/learningsMeta';
import { AreaIcon } from '../features/entries/entryMeta';

type Creating = { area: string; parent_id: string | null };

// Das Wiki: Bereichs-Umschalter + Seitenbaum links, die Seite rechts (mobil eins von
// beiden). Übersicht und Seite laufen über dieselbe Route (/learnings/:slug?); zur frisch
// angelegten Seite geht es erst, wenn der Anlege-Editor schließt (siehe createdSlug). Eine Live-
// Abfrage speist Baum und Seite; der Bereich folgt der Seite, sonst dem ?area=-Parameter,
// sonst dem meistgenutzten Bereich. Bereiche sind frei vergebener Text: die Chips entstehen
// aus den Bereichen der vorhandenen Seiten, ein leeres Wiki zeigt keine.
// Die Belege (learning_sources) werden hier einmal mit Einträgen und Notizen verbunden;
// Seite, Übersicht und Editor bekommen davon nur ihren Ausschnitt.
export function Learnings() {
  const { slug } = useParams<{ slug?: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const { data: all, loading, error } = useLiveQuery(listLearnings, ['learnings'], [], 'learnings:all');
  const { data: attachments } = useLiveQuery(() => listLearningAttachments(), ['learning_attachments'], [], 'learning_attachments:all');

  const { data: sources } = useLiveQuery(listLearningSources, ['learning_sources'], [], 'learning_sources:all');
  const { data: entries } = useLiveQuery(() => listEntries(), ['entries'], [], 'learnings:entries');
  // Archivierte Notizen bleiben gültige Belege; nur gelöschte fallen heraus.
  const { data: notes } = useLiveQuery(
    async () => {
      const [live, archived] = await Promise.all([listNotes({ includeSuperseded: true }), listArchivedNotes()]);
      return [...live, ...archived];
    },
    ['notes'],
    [],
    'learnings:notes',
  );

  const entryMap = useMemo(() => new Map<string, Entry>((entries ?? []).map((e) => [e.id, e])), [entries]);
  const noteMap = useMemo(() => new Map<string, Note>((notes ?? []).map((n) => [n.id, n])), [notes]);
  const resolved = useMemo(() => resolveSources(sources ?? [], entryMap, noteMap), [sources, entryMap, noteMap]);
  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resolved) m.set(r.source.learning_id, (m.get(r.source.learning_id) ?? 0) + 1);
    return m;
  }, [resolved]);

  const pages = all ?? [];
  const page = slug ? pages.find((p) => p.slug === slug) : undefined;
  const areas = useMemo(() => collectAreas(pages), [pages]);
  const area: string = page?.area ?? (params.get('area') || areas[0]?.area || '');
  const inArea = useMemo(() => pages.filter((p) => p.area === area), [pages, area]);
  const pageAttachments = useMemo(
    () => (attachments ?? []).filter((a) => a.learning_id === page?.id),
    [attachments, page?.id],
  );

  const pageSources = useMemo(() => resolved.filter((r) => r.source.learning_id === page?.id), [resolved, page?.id]);

  const [editing, setEditing] = useState<Learning | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  // Der Rahmen (AppShell) remountet die Route bei jedem Pfadwechsel; ein Sprung zur frisch
  // angelegten Seite würde den offenen Anlege-Editor also schließen. Deshalb merkt sich der
  // Editor die neue Adresse nur und die Navigation folgt erst beim Schließen.
  const createdSlug = useRef<string | null>(null);

  // Direkt nach dem Anlegen zeigt die Live-Liste die neue Seite erst nach dem Refetch —
  // solange der Anlege-Editor offen ist, ist „nicht gefunden" also nur „noch nicht da".
  const notFound = Boolean(slug) && all !== null && !page && !creating;


  const remove = useCallback(async () => {
    if (!page) return;
    await deleteLearning(page.id);
    navigate(areaHref(page.area));
  }, [page, navigate]);

  return (
    <div className="page page--wide">
      <div className="page__header">
        <h1 className="page__title">Learnings</h1>
        <Button variant="primary" size="sm" onClick={() => setCreating({ area, parent_id: null })}>
          <Plus size={16} /> Seite
        </Button>
      </div>

      <div className={clsx('wiki', slug && 'wiki--page')}>
        <aside className="wiki__nav">
          <div className="row wrap gap-xs" role="tablist" aria-label="Bereich">
            {areas.map(({ area: a, count }) => (
              <button
                key={a}
                type="button"
                role="tab"
                aria-selected={area === a}
                className={clsx('chip', area === a && 'chip--active')}
                onClick={() => navigate(areaHref(a))}
              >
                <AreaIcon size={12} style={{ marginRight: 4 }} />
                {a} ({count})
              </button>
            ))}
            {all && areas.length === 0 && <span className="muted area-empty">Noch keine Bereiche — vergib beim Speichern einen.</span>}
          </div>
          <LearningsNav
            area={area}
            pages={inArea}
            activeSlug={slug}
            loading={loading}
            error={error}
            onCreateChild={(parent) => setCreating({ area: parent.area, parent_id: parent.id })}
          />
        </aside>

        <section className="wiki__page">
          {page ? (
            <LearningPage
              page={page}
              pages={pages}
              attachments={pageAttachments}
              sources={pageSources}
              onEdit={() => setEditing(page)}
              onCreateChild={() => setCreating({ area: page.area, parent_id: page.id })}
              onDelete={remove}
            />
          ) : notFound ? (
            <div className="empty">
              Keine Seite mit der Adresse „{slug}“.{' '}
              <Link to={areaHref(area)}>Zur Übersicht</Link>
            </div>
          ) : error && slug ? (
            <div className="empty">
              Seiten konnten nicht geladen werden: {error}{' '}
              <Link to={areaHref(area)}>Zur Übersicht</Link>
            </div>
          ) : slug ? (
            <div className="empty">Lädt…</div>
          ) : (
            <AreaOverview area={area} pages={inArea} sourceCounts={sourceCounts} loading={loading} onCreate={() => setCreating({ area, parent_id: null })} />
          )}
        </section>
      </div>

      {creating && (
        <LearningEditor
          learning={null}
          open
          onClose={() => {
            setCreating(null);
            const slug = createdSlug.current;
            createdSlug.current = null;
            if (slug) navigate(`/learnings/${slug}`);
          }}
          defaults={creating}
          pages={pages}
          sources={resolved}
          entries={entries ?? []}
          notes={notes ?? []}
          onCreated={(l) => {
            createdSlug.current = l.slug;
          }}
        />
      )}
      {editing && (
        <LearningEditor
          learning={editing}
          open
          onClose={() => setEditing(null)}
          pages={pages}
          sources={resolved}
          entries={entries ?? []}
          notes={notes ?? []}
        />
      )}
    </div>
  );
}

/** Rechte Spalte ohne gewählte Seite (Desktop): die obersten Seiten des Bereichs als Gruppe. */
function AreaOverview({
  area,
  pages,
  sourceCounts,
  loading,
  onCreate,
}: {
  area: string;
  pages: Learning[];
  /** Belege je Seite (nur Quellen, die noch leben). */
  sourceCounts: Map<string, number>;
  loading: boolean;
  onCreate: () => void;
}) {
  const roots = useMemo(() => buildTree(pages), [pages]);
  return (
    <div className="stack gap-xs">
      <div className="section-title row gap-xs center">
        <AreaIcon size={14} /> {area || 'Wiki'}
        {pages.length > 0 && <span style={{ fontWeight: 400 }}>({pages.length})</span>}
      </div>
      {loading && pages.length === 0 ? (
        <div className="empty">Lädt…</div>
      ) : roots.length === 0 ? (
        <div className="empty">
          {area ? `Noch keine Seiten in ${area}.` : 'Noch keine Seiten.'}{' '}
          <button type="button" className="link-btn" onClick={onCreate}>
            Erste Seite anlegen
          </button>
        </div>
      ) : (
        <div className="group group--tile">
          {roots.map((p) => (
            <Link key={p.id} to={`/learnings/${p.slug}`} className="item-row">
              <div className="icon-tile icon-tile--sm">
                <FileText size={14} />
              </div>
              <div className="item-row__main">
                <div className="item-row__title">{p.title}</div>
                {p.summary && <div className="item-row__sub">{p.summary}</div>}
              </div>
              {(sourceCounts.get(p.id) ?? 0) > 0 && (
                <span className="wiki__count" title="Belege">
                  {sourceCounts.get(p.id)} {sourceCounts.get(p.id) === 1 ? 'Beleg' : 'Belege'}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
