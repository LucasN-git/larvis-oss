import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, Paperclip, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { SOURCE_PLATFORMS, collectAreas, entryInArea, type Entry, type SourcePlatform } from '@larvis/shared';
import { listEntries, listLearningSources, listLearnings } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { MQ } from '../../theme/breakpoints';
import { Badge, Button, Chip, TextInput } from '../../components/ui';
import {
  AreaIcon,
  PLATFORM_ICONS,
  PLATFORM_LABELS,
  formatLength,
  learningsByEntry,
  linkHref,
  type EntryLearningLink,
} from './entryMeta';
import { openUpload } from '../notes/attachmentUtil';
import { EntryEditorModal } from './EntryEditorModal';

// Der eine Tab für alle Einträge. Filterzustand lebt in den URL-Search-Params
// (area, category, tag, platform, distilled, q), damit Deep-Links funktionieren. Die
// Bereichs-Chips entstehen aus den Bereichen, die in den Einträgen vorkommen (frei
// vergebener Text, häufigste zuerst); ohne Einträge gibt es keine Chips. Volltext läuft
// serverseitig (q) und trifft auch den eigenen Kommentar, alle anderen Filter
// clientseitig — der Datensatz ist klein. Der Kommentar („warum gespeichert") steht
// sichtbar am Eintrag; in der engen Handy-Zeile ersetzt er die Beschreibung.
// Fließt ein Eintrag in Learnings ein (Beleg einer Wiki-Seite), zeigt er das als Chip
// „→ Titel" mit Link auf die Seite; der Filter distilled trennt danach, was schon
// destilliert ist und was noch nicht.

const NO_CATEGORY = 'Ohne Kategorie';
/** Woran Einträge derselben Quelle hängen: die URL oder — bei Datei-Items — die hochgeladene Datei. */
const sourceKey = (e: Pick<Entry, 'url' | 'upload_id'>): string | null => e.url ?? (e.upload_id ? `upload:${e.upload_id}` : null);
const isPlatform = (v: string | null): v is SourcePlatform => SOURCE_PLATFORMS.includes(v as SourcePlatform);
/** Dreiwert-Filter nach Learnings: kein Parameter = alle, „ohne" = noch nicht destilliert, „mit" = destilliert. */
type DistilledFilter = 'ohne' | 'mit';
const isDistilled = (v: string | null): v is DistilledFilter => v === 'ohne' || v === 'mit';
/** Wie viele Learning-Chips ein Eintrag zeigt, bevor der Rest als „+n" zusammengefasst wird. */
const MAX_LEARNING_CHIPS = 2;
const NO_LEARNINGS: EntryLearningLink[] = [];

function groupBy(entries: Entry[], key: (e: Entry) => string, order?: readonly string[]): [string, Entry[]][] {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = key(e);
    let list = groups.get(k);
    if (!list) groups.set(k, (list = []));
    list.push(e);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (order) return order.indexOf(a) - order.indexOf(b);
    if (a === NO_CATEGORY) return 1;
    if (b === NO_CATEGORY) return -1;
    return a.localeCompare(b, 'de');
  });
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={clsx('chip', active && 'chip--active')} onClick={onClick}>
      {children}
    </button>
  );
}

interface EntryItemProps {
  entry: Entry;
  /** Wie viele Einträge sich die Quelle teilen; ab zwei erscheint der „×N"-Chip. */
  shared: number;
  /** Die Learnings, in die der Eintrag einfließt. */
  learnings: EntryLearningLink[];
  onEdit: () => void;
}

// div[role=button] statt <button>: Zeile und Kachel enthalten den Link oder den
// Datei-Button, und interaktive Elemente dürfen nicht verschachteln.
function editTrigger(onEdit: () => void) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onEdit,
    onKeyDown: (ev: React.KeyboardEvent<HTMLDivElement>) => {
      if (ev.target !== ev.currentTarget) return; // Link/Datei-Button aktivieren sich selbst
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onEdit();
      }
    },
  };
}

/**
 * Die Learnings eines Eintrags als dezente Chips mit Link auf die Wiki-Seite. Der Klick
 * bleibt am Link und öffnet nicht den Editor der Zeile; mehr als zwei fasst „+n" zusammen.
 */
function LearningChips({ learnings }: { learnings: EntryLearningLink[] }) {
  if (learnings.length === 0) return null;
  const rest = learnings.slice(MAX_LEARNING_CHIPS);
  return (
    <>
      {learnings.slice(0, MAX_LEARNING_CHIPS).map(({ source, learning }) => (
        <Link
          key={source.id}
          to={`/learnings/${learning.slug}`}
          className="chip entry-learning"
          title={`Fließt ein in: ${learning.title}`}
          onClick={(ev) => ev.stopPropagation()}
        >
          → {learning.title}
        </Link>
      ))}
      {rest.length > 0 && (
        <Chip className="entry-learning" title={rest.map((l) => l.learning.title).join(', ')}>
          +{rest.length}
        </Chip>
      )}
    </>
  );
}

function EntryMeta({ entry: e, shared, learnings }: { entry: Entry; shared: number; learnings: EntryLearningLink[] }) {
  const PlatformIcon = e.source_platform ? PLATFORM_ICONS[e.source_platform] : null;
  const length = formatLength(e);
  return (
    <>
      <Badge>{e.area}</Badge>
      {/* Weitere Bereiche dezent als Text; der Hauptbereich steht im Badge. */}
      {e.also_areas?.length > 0 && (
        <span className="entry-meta" title={`Auch in: ${e.also_areas.join(', ')}`}>
          + {e.also_areas.join(', ')}
        </span>
      )}
      {(PlatformIcon || e.source_author || e.upload || length) && (
        <span className="entry-meta">
          {PlatformIcon && <PlatformIcon size={12} />}
          {e.source_author && <span>{e.source_author}</span>}
          {e.upload && <span>{e.upload.filename}</span>}
          {length && <span>· {length}</span>}
        </span>
      )}
      <LearningChips learnings={learnings} />
      {shared > 1 && <Chip title="Weitere Einträge aus dieser Quelle">×{shared}</Chip>}
      {e.tags.slice(0, 3).map((t) => (
        <Chip key={t}>{t}</Chip>
      ))}
    </>
  );
}

/** Öffnet die Quelle: einen Link in neuem Tab, sonst die hochgeladene Datei. In der Kachel beschriftet. */
function SourceButton({ entry: e, labelled = false }: { entry: Entry; labelled?: boolean }) {
  const className = labelled ? 'btn btn--sm entry-tile__open' : 'icon-btn icon-btn--bare';
  const href = linkHref(e.url);
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" aria-label={`${e.name} öffnen`} className={className} onClick={(ev) => ev.stopPropagation()}>
        <ExternalLink size={labelled ? 14 : 16} />
        {labelled && 'Öffnen'}
      </a>
    );
  }
  const upload = e.upload;
  if (!upload) return null;
  return (
    <button
      type="button"
      aria-label={`${upload.filename} öffnen`}
      title={upload.filename}
      className={className}
      onClick={(ev) => {
        ev.stopPropagation();
        void openUpload(upload);
      }}
    >
      <Paperclip size={labelled ? 14 : 16} />
      {labelled && 'Datei öffnen'}
    </button>
  );
}

function EntryRow({ entry: e, shared, learnings, onEdit }: EntryItemProps) {
  return (
    <div className="item-row entry-row" {...editTrigger(onEdit)}>
      <div className="icon-tile icon-tile--sm">
        <AreaIcon size={14} />
      </div>
      <div className="item-row__main">
        <div className="item-row__title">{e.name}</div>
        {e.comment ? (
          <div className="entry-comment" title={e.comment}>
            {e.comment}
          </div>
        ) : (
          e.description && <div className="item-row__sub">{e.description}</div>
        )}
        <div className="meta-row" style={{ marginTop: 4 }}>
          <EntryMeta entry={e} shared={shared} learnings={learnings} />
        </div>
      </div>
      <SourceButton entry={e} />
    </div>
  );
}

function EntryTile({ entry: e, shared, learnings, onEdit }: EntryItemProps) {
  return (
    <div className="tile entry-tile" {...editTrigger(onEdit)}>
      <div className="entry-tile__head">
        <div className="icon-tile icon-tile--sm">
          <AreaIcon size={14} />
        </div>
        <div className="tile__title">{e.name}</div>
      </div>
      {e.comment && <div className="entry-comment">{e.comment}</div>}
      {e.description && <div className="entry-tile__desc">{e.description}</div>}
      <div className="meta-row">
        <EntryMeta entry={e} shared={shared} learnings={learnings} />
      </div>
      <SourceButton entry={e} labelled />
    </div>
  );
}

export function EntryList() {
  const [params, setParams] = useSearchParams();
  const area = params.get('area') || null;
  const category = params.get('category');
  const tag = params.get('tag');
  const platform = isPlatform(params.get('platform')) ? (params.get('platform') as SourcePlatform) : null;
  const distilled = isDistilled(params.get('distilled')) ? (params.get('distilled') as DistilledFilter) : null;
  const q = params.get('q') ?? '';
  // Ab Tablet-Breite Kacheln mit ganzer Beschreibung und Öffnen-Button, auf dem Handy die Liste.
  const tiles = !useMediaQuery(MQ.phone);

  const setParam = (key: string, value: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        // Bereich wechseln setzt Kategorie, Tag und Plattform zurück — die gelten nur innerhalb eines Bereichs.
        if (key === 'area') {
          next.delete('category');
          next.delete('tag');
          next.delete('platform');
        }
        return next;
      },
      { replace: true },
    );
  };

  // Die Suche tippt in einen lokalen Entwurf und schiebt ihn gedrosselt in die URL:
  // der Router aktualisiert die Search-Params in einer Transition, die einzelne
  // Anschläge verschluckt, und jede Änderung löst eine Server-Suche aus.
  // params steht in den Abhängigkeiten, weil setParam die zum Rendern gehörenden
  // Search-Params einschließt: ohne ihn würde ein währenddessen gesetzter Filter-Chip
  // vom laufenden Timer wieder auf den alten Stand zurückgeschrieben.
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => setParam('q', draft || null), 250);
    return () => clearTimeout(t);
  }, [draft, q, params]);

  const query = q.trim() || undefined;
  const fetcher = useCallback(() => listEntries({ query }), [query]);
  // Suchergebnisse werden nicht gecacht: ein Cache-Key je Suchbegriff wäre unbegrenzt.
  const { data: all, loading } = useLiveQuery(fetcher, ['entries'], [query], query ? undefined : 'entries:all');
  // Belege und Seiten des Wikis, umgekehrt gelesen: in welche Learnings fließt ein Eintrag ein?
  const { data: sources } = useLiveQuery(listLearningSources, ['learning_sources'], [], 'learning_sources:all');
  const { data: learnings } = useLiveQuery(listLearnings, ['learnings'], [], 'learnings:all');
  const learningsOf = useMemo(() => learningsByEntry(sources ?? [], learnings ?? []), [sources, learnings]);
  const linksOf = (e: Entry) => learningsOf.get(e.id) ?? NO_LEARNINGS;

  // Ein Bereich zeigt Einträge mit diesem Haupt- oder weiteren Bereich.
  const byArea = useMemo(() => (all ?? []).filter((e) => !area || entryInArea(e, area)), [all, area]);
  const visible = useMemo(
    () =>
      byArea.filter(
        (e) =>
          (!category || (e.category?.trim() || NO_CATEGORY) === category) &&
          (!tag || e.tags.includes(tag)) &&
          (!platform || e.source_platform === platform) &&
          (!distilled || (distilled === 'mit') === learningsOf.has(e.id)),
      ),
    [byArea, category, tag, platform, distilled, learningsOf],
  );

  // Die vorhandenen Bereiche mit Anzahl, häufigste zuerst — Quelle der Chips und der Gruppenfolge.
  const areas = useMemo(() => collectAreas(all ?? []), [all]);
  const areaOrder = useMemo(() => areas.map((a) => a.area), [areas]);
  const categories = useMemo(
    () => (area ? [...new Set(byArea.map((e) => e.category?.trim() || NO_CATEGORY))].sort((a, b) => a.localeCompare(b, 'de')) : []),
    [byArea, area],
  );
  const platforms = useMemo(
    () => SOURCE_PLATFORMS.filter((p) => byArea.some((e) => e.source_platform === p)),
    [byArea],
  );
  const tags = useMemo(
    () => [...new Set(byArea.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b, 'de')),
    [byArea],
  );
  // Wie viele Einträge teilen sich eine Quelle? Steuert den „×N"-Chip in der Zeile.
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of all ?? []) {
      const k = sourceKey(e);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [all]);

  const groups = area
    ? groupBy(visible, (e) => e.category?.trim() || NO_CATEGORY)
    : groupBy(visible, (e) => e.area, areaOrder);

  const [editing, setEditing] = useState<Entry | null>(null);
  const [creating, setCreating] = useState(false);
  const siblingsOf = (e: Entry | null) => {
    const k = e ? sourceKey(e) : null;
    return k ? (all ?? []).filter((s) => sourceKey(s) === k && s.id !== e!.id) : [];
  };

  return (
    <div className="stack gap-md">
      <div className="row wrap gap-xs">
        <FilterChip active={!area} onClick={() => setParam('area', null)}>
          Alle {all ? `(${all.length})` : ''}
        </FilterChip>
        {areas.map(({ area: a, count }) => (
          <FilterChip key={a} active={area === a} onClick={() => setParam('area', area === a ? null : a)}>
            <AreaIcon size={12} style={{ marginRight: 4 }} />
            {a} ({count})
          </FilterChip>
        ))}
        {/* Ein Bereich aus der URL, den kein Eintrag (mehr) trägt, bleibt als aktiver Chip sichtbar. */}
        {area && !areaOrder.includes(area) && (
          <FilterChip active onClick={() => setParam('area', null)}>
            <AreaIcon size={12} style={{ marginRight: 4 }} />
            {area}
          </FilterChip>
        )}
        {all && !query && areas.length === 0 && <span className="muted area-empty">Noch keine Bereiche — vergib beim Speichern einen.</span>}
      </div>

      <div className="quick-add">
        <TextInput placeholder="Suchen…" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button variant="primary" onClick={() => setCreating(true)} aria-label="Hinzufügen">
          <Plus size={18} />
        </Button>
      </div>

      <div className="stack gap-xs">
        {/* Destilliert: gilt über alle Bereiche und bleibt beim Bereichswechsel stehen. */}
        <div className="row wrap gap-xs">
          <FilterChip active={distilled === 'ohne'} onClick={() => setParam('distilled', distilled === 'ohne' ? null : 'ohne')}>
            Noch nicht destilliert
          </FilterChip>
          <FilterChip active={distilled === 'mit'} onClick={() => setParam('distilled', distilled === 'mit' ? null : 'mit')}>
            Destilliert
          </FilterChip>
        </div>
        {categories.length > 1 && (
          <div className="row wrap gap-xs">
            {categories.map((c) => (
              <FilterChip key={c} active={category === c} onClick={() => setParam('category', category === c ? null : c)}>
                {c}
              </FilterChip>
            ))}
          </div>
        )}
        {platforms.length > 1 && (
          <div className="row wrap gap-xs">
            {platforms.map((p) => {
              const Icon = PLATFORM_ICONS[p];
              return (
                <FilterChip key={p} active={platform === p} onClick={() => setParam('platform', platform === p ? null : p)}>
                  <Icon size={12} style={{ marginRight: 4 }} />
                  {PLATFORM_LABELS[p]}
                </FilterChip>
              );
            })}
          </div>
        )}
        {tags.length > 0 && (
          <div className="row wrap gap-xs">
            {tags.map((t) => (
              <FilterChip key={t} active={tag === t} onClick={() => setParam('tag', tag === t ? null : t)}>
                {t}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {all && visible.length === 0 && !loading && (
        <div className="empty">{q || category || tag || platform || distilled ? 'Nichts gefunden.' : 'Noch nichts einsortiert.'}</div>
      )}

      {groups.map(([title, group]) => (
        <div key={title} className="stack gap-xs">
          <div className="section-title">{title}</div>
          <div className={tiles ? 'card-grid' : 'group group--tile'}>
            {group.map((e) => {
              const key = sourceKey(e);
              const item = { entry: e, shared: key ? (sourceCounts.get(key) ?? 0) : 0, learnings: linksOf(e), onEdit: () => setEditing(e) };
              return tiles ? <EntryTile key={e.id} {...item} /> : <EntryRow key={e.id} {...item} />;
            })}
          </div>
        </div>
      ))}

      {creating && (
        <EntryEditorModal
          entry={null}
          open
          onClose={() => setCreating(false)}
          defaultArea={area ?? (query ? '' : (areas[0]?.area ?? ''))}
          siblings={[]}
          entries={all ?? []}
        />
      )}
      {editing && (
        <EntryEditorModal
          key={editing.id}
          entry={editing}
          open
          onClose={() => setEditing(null)}
          siblings={siblingsOf(editing)}
          onOpenSibling={setEditing}
          entries={all ?? []}
          learnings={linksOf(editing)}
        />
      )}
    </div>
  );
}
