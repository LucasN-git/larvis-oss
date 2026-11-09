import { useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { LEARNWEB_MODTYPE_LABELS, type LearnwebCourse, type LearnwebItem } from '@larvis/shared';
import { listLearnwebItems } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Badge } from '../../components/ui';
import { isNewSince, modtypeIcon } from './helpers';
import './learnweb.css';

/** Materialien eines Kurses, nach Sektion gruppiert. Jede Zeile öffnet Learnweb. */
export function CourseContent({ course }: { course: LearnwebCourse }) {
  const fetcher = useCallback(() => listLearnwebItems(course.id), [course.id]);
  const { data: items, loading } = useLiveQuery(fetcher, ['learnweb_items'], [course.id], `lw:items:${course.id}`);

  if (items && items.length === 0 && !loading) {
    return <div className="empty">Keine Materialien im Cache.</div>;
  }
  if (!items) return null;

  const sections = groupBySection(items);

  return (
    <div className="stack gap-md">
      {sections.map(([section, group]) => (
        <div key={section} className="stack gap-xs">
          <div className="section-title">{section}</div>
          <div className="group group--tile">
            {group.map((it) => {
              const Icon = modtypeIcon(it.modtype);
              const label = it.type_label || LEARNWEB_MODTYPE_LABELS[it.modtype] || it.modtype;
              return (
                <a
                  key={it.id}
                  className="item-row"
                  href={it.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div className="icon-tile icon-tile--sm">
                    <Icon size={14} />
                  </div>
                  <div className="item-row__main">
                    <div className="item-row__title">{it.name}</div>
                    <div className="meta-row" style={{ marginTop: 4 }}>
                      {it.subsection_name && <span className="item-row__sub">{it.subsection_name}</span>}
                      <span className="item-row__sub">{label}</span>
                      {it.size_text && <span className="item-row__sub">{it.size_text}</span>}
                      {isNewSince(it.first_seen_at, course.first_seen_at) && <Badge tone="accent">Neu</Badge>}
                    </div>
                  </div>
                  <ExternalLink size={16} style={{ color: 'var(--text-muted)' }} />
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Items in Reihenfolge nach Sektion bündeln (Reihenfolge des ersten Auftretens). */
function groupBySection(items: LearnwebItem[]): [string, LearnwebItem[]][] {
  const groups = new Map<string, LearnwebItem[]>();
  for (const it of items) {
    const key = it.section_name || 'Allgemeines';
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(it);
  }
  return [...groups.entries()];
}
