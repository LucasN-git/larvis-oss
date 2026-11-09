import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ExternalLink, FileText, Pencil, Plus, Quote, Trash2 } from 'lucide-react';
import { LEARNING_SOURCE_ROLE_LABELS, pathTo, type Learning, type LearningAttachment } from '@larvis/shared';
import { formatRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { Markdown } from '../../components/Markdown';
import { Modal } from '../../components/Modal';
import { Button, Chip } from '../../components/ui';
import { areaHref, groupByRole, type ResolvedSource } from './learningsMeta';
import { AreaIcon } from '../entries/entryMeta';
import { useLearningRenderers } from './learningMarkdown';

// Lesesicht einer Wiki-Seite: Pfad, Titel, Teaser, Meta, gerenderter Body mit Grafiken,
// darunter die Belege (nach Rolle gruppiert) und die Unterseiten. Bearbeiten öffnet den Editor; Löschen ist ein Soft-Delete
// mit Rückfrage (Wiederherstellen über das MCP-Tool restore_learning).
export function LearningPage({
  page,
  pages,
  attachments,
  sources,
  onEdit,
  onCreateChild,
  onDelete,
}: {
  page: Learning;
  pages: Learning[];
  attachments: LearningAttachment[];
  /** Belege dieser Seite, bereits mit ihren Quellen verbunden (Gelöschtes fehlt). */
  sources: ResolvedSource[];
  onEdit: () => void;
  onCreateChild: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { notify } = useToast();
  const { renderImage, renderLink } = useLearningRenderers(attachments);

  const crumbs = pathTo(pages, page.id).slice(0, -1);
  const children = pages
    .filter((p) => p.parent_id === page.id)
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));

  return (
    <article className="wiki__article">
      <Link to={areaHref(page.area)} className="wiki__back">
        <ChevronLeft size={16} /> Learnings
      </Link>

      <nav className="wiki__crumbs" aria-label="Pfad">
        <Link to={areaHref(page.area)}>{page.area}</Link>
        {crumbs.map((c) => (
          <span key={c.id}>
            {' / '}
            <Link to={`/learnings/${c.slug}`}>{c.title}</Link>
          </span>
        ))}
      </nav>

      <div className="row between wrap gap-sm" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 className="wiki__title">{page.title}</h2>
          {page.summary && <p className="wiki__summary">{page.summary}</p>}
        </div>
        <div className="wiki__actions">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil size={14} /> Bearbeiten
          </Button>
          <Button variant="ghost" size="sm" onClick={onCreateChild}>
            <Plus size={14} /> Unterseite
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} style={{ color: 'var(--danger)' }}>
            <Trash2 size={14} /> Löschen
          </Button>
        </div>
      </div>

      <div className="wiki__meta">
        <span className="row gap-xs center">
          <AreaIcon size={13} /> {page.area}
        </span>
        <span>aktualisiert {formatRelative(page.updated_at)}</span>
        {sources.length > 0 && (
          <span className="row gap-xs center">
            <Quote size={13} /> {sources.length} {sources.length === 1 ? 'Beleg' : 'Belege'}
          </span>
        )}
        {page.tags.map((t) => (
          <Chip key={t}>{t}</Chip>
        ))}
      </div>

      {page.body_md.trim() ? (
        <Markdown className="wiki__body" renderImage={renderImage} renderLink={renderLink}>
          {page.body_md}
        </Markdown>
      ) : (
        <div className="empty">
          Diese Seite hat noch keinen Inhalt.{' '}
          <button type="button" className="link-btn" onClick={onEdit}>
            Jetzt schreiben
          </button>
        </div>
      )}

      {sources.length > 0 && (
        <section className="wiki__sources">
          <div className="section-title">Belege</div>
          <div className="stack gap-sm">
            {groupByRole(sources).map((g) => (
              <div key={g.role} className="stack gap-xs">
                <div className="wiki__role">{LEARNING_SOURCE_ROLE_LABELS[g.role]}</div>
                <div className="group group--tile">
                  {g.items.map((s) => (
                    <SourceRow key={s.source.id} item={s} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {children.length > 0 && (
        <section className="wiki__children">
          <div className="section-title">Unterseiten</div>
          <div className="group group--tile">
            {children.map((c) => (
              <Link key={c.id} to={`/learnings/${c.slug}`} className="item-row">
                <div className="icon-tile icon-tile--sm">
                  <FileText size={14} />
                </div>
                <div className="item-row__main">
                  <div className="item-row__title">{c.title}</div>
                  {c.summary && <div className="item-row__sub">{c.summary}</div>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Seite löschen?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await onDelete();
                  setConfirming(false);
                } catch (e) {
                  notify(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.', 'error');
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? 'Löscht…' : 'Löschen'}
            </Button>
          </>
        }
      >
        <p>
          „{page.title}" verschwindet aus dem Wiki. Unterseiten bleiben erhalten; Claude kann die Seite mit
          <code> restore_learning</code> wiederherstellen.
        </p>
      </Modal>
    </article>
  );
}

/** Eine Zeile unter „Belege": Einträge mit URL öffnen extern, Notizen führen zu den Notizen. */
function SourceRow({ item }: { item: ResolvedSource }) {
  const Icon = item.icon;
  const inner = (
    <>
      <div className="icon-tile icon-tile--sm">
        <Icon size={14} />
      </div>
      <div className="item-row__main">
        <div className="item-row__title">{item.title}</div>
        {item.source.comment && <div className="item-row__sub">{item.source.comment}</div>}
      </div>
      {item.external && <ExternalLink size={14} className="wiki__source-ext" aria-hidden />}
    </>
  );
  if (item.href && item.external) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className="item-row">
        {inner}
      </a>
    );
  }
  if (item.href) {
    return (
      <Link to={item.href} className="item-row">
        {inner}
      </Link>
    );
  }
  return <div className="item-row">{inner}</div>;
}
