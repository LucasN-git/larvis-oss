import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { listBriefings, markBriefingRead } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Badge, Card, IconButton } from '../../components/ui';
import { Markdown } from '../../components/Markdown';

// Alle Tages-Briefings, neuestes zuerst (Tab Profil → "Briefings"). Aufklappbar
// pro Tag; das neueste startet offen. Ungelesene lassen sich hier auch abhaken.
export function BriefingHistory() {
  const { data: briefings } = useLiveQuery(listBriefings, ['briefings'], [], 'briefings:all');
  const [openId, setOpenId] = useState<string | null>(null);

  if (!briefings) return <div className="empty">Lädt…</div>;
  if (briefings.length === 0) return <div className="empty">Noch keine Briefings.</div>;

  // Ohne explizite Auswahl ist das neueste aufgeklappt.
  const expandedId = openId ?? briefings[0].id;

  return (
    <div className="stack gap-md">
      {briefings.map((b) => {
        const expanded = b.id === expandedId;
        return (
          <Card key={b.id} pad="sm">
            <div
              className="row gap-sm"
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setOpenId(expanded ? '' : b.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenId(expanded ? '' : b.id);
                }
              }}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <div style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
                {format(parseISO(b.date), 'EEEE, d. MMMM yyyy', { locale: de })}
              </div>
              {b.read_at ? (
                <Badge>Gelesen</Badge>
              ) : (
                <>
                  <Badge tone="accent">Ungelesen</Badge>
                  <IconButton
                    size="sm"
                    variant="bare"
                    label="Als gelesen markieren"
                    onClick={(e) => {
                      e.stopPropagation();
                      markBriefingRead(b.id);
                    }}
                  >
                    <Check size={15} />
                  </IconButton>
                </>
              )}
            </div>
            {expanded && (
              <div style={{ marginTop: 10 }}>
                <Markdown>{b.content_md}</Markdown>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
