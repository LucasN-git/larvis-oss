import { useCallback } from 'react';
import { CalendarClock, ExternalLink } from 'lucide-react';
import type { LearnwebCourse } from '@larvis/shared';
import { listLearnwebEvents } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Chip } from '../../components/ui';
import { formatDue } from '../../lib/format';
import './learnweb.css';

/** Anstehende Abgaben & Termine (aus learnweb_events, nächste zwei Wochen). */
export function UpcomingEvents({ courses }: { courses: LearnwebCourse[] }) {
  const fetcher = useCallback(() => listLearnwebEvents(), []);
  const { data: events } = useLiveQuery(fetcher, ['learnweb_events'], [], 'lw:events');
  const shortById = new Map(courses.map((c) => [c.id, c.shortname]));

  if (!events || events.length === 0) return null;

  return (
    <div className="stack gap-xs">
      <div className="section-title">Anstehende Abgaben & Termine</div>
      <div className="group group--tile">
        {events.map((e) => {
          const due = formatDue(e.starts_at);
          const short = e.course_id ? shortById.get(e.course_id) : null;
          return (
            <div key={e.id} className="item-row">
              <div className="icon-tile icon-tile--sm">
                <CalendarClock size={14} />
              </div>
              <div className="item-row__main">
                <div className="item-row__title">{e.name}</div>
                <div className="meta-row" style={{ marginTop: 4 }}>
                  {short && <Chip>{short}</Chip>}
                  {due && (
                    <span className="item-row__sub" style={{ color: due.overdue ? 'var(--danger)' : undefined }}>
                      {due.label}
                    </span>
                  )}
                </div>
              </div>
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${e.name} in Learnweb öffnen`}
                  className="icon-btn icon-btn--bare"
                >
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
