import { useCallback, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { LearnwebAnnouncement, LearnwebCourse } from '@larvis/shared';
import { listLearnwebAnnouncements } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Badge, Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { Markdown } from '../../components/Markdown';
import { formatRelative } from '../../lib/format';
import { isNewSince } from './helpers';
import './learnweb.css';

/** Ankündigungen eines Kurses; Klick öffnet den vollen Beitrag im Modal. */
export function AnnouncementList({ course }: { course: LearnwebCourse }) {
  const fetcher = useCallback(() => listLearnwebAnnouncements(course.id), [course.id]);
  const { data: items, loading } = useLiveQuery(
    fetcher,
    ['learnweb_announcements'],
    [course.id],
    `lw:ann:${course.id}`,
  );
  const [open, setOpen] = useState<LearnwebAnnouncement | null>(null);

  if (items && items.length === 0 && !loading) {
    return <div className="empty">Keine Ankündigungen im Cache.</div>;
  }
  if (!items) return null;

  return (
    <>
      <div className="group">
        {items.map((a) => (
          <div
            key={a.id}
            className="item-row"
            role="button"
            tabIndex={0}
            onClick={() => setOpen(a)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                setOpen(a);
              }
            }}
          >
            <div className="item-row__main">
              <div className="item-row__title">{a.subject}</div>
              <div className="meta-row" style={{ marginTop: 4 }}>
                {a.author && <span className="item-row__sub">{a.author}</span>}
                {a.posted_at && <span className="item-row__sub">{formatRelative(a.posted_at)}</span>}
                {isNewSince(a.first_seen_at, course.first_seen_at) && <Badge tone="accent">Neu</Badge>}
              </div>
              {a.body_text && (
                <div className="item-row__sub" style={{ marginTop: 4, maxHeight: '2.6em', overflow: 'hidden' }}>
                  {a.body_text.replace(/\s+/g, ' ').slice(0, 160)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {open && (
        <Modal
          open
          onClose={() => setOpen(null)}
          title={open.subject}
          footer={
            <a href={open.url} target="_blank" rel="noreferrer">
              <Button>
                <ExternalLink size={16} /> Im Learnweb öffnen
              </Button>
            </a>
          }
        >
          <div className="meta-row" style={{ marginBottom: 12 }}>
            {open.author && <span className="item-row__sub">{open.author}</span>}
            {open.posted_at && <span className="item-row__sub">{formatRelative(open.posted_at)}</span>}
          </div>
          <Markdown>{open.body_text || '_Kein Text._'}</Markdown>
        </Modal>
      )}
    </>
  );
}
