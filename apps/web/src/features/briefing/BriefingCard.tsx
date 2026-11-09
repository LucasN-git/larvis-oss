import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Check } from 'lucide-react';
import { getLatestBriefing, markBriefingRead } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Card, IconButton } from '../../components/ui';
import { Markdown } from '../../components/Markdown';

// Zeigt das neueste Tages-Briefing (von Claude über das MCP-Tool save_briefing geschrieben),
// solange es ungelesen ist. Der Haken setzt read_at und die Card verschwindet;
// die Historie bleibt im Tab Profil unter "Briefings" einsehbar.
// Rendert ohne eigenen Außenabstand — der Parent (stack) übernimmt das Spacing.
export function BriefingCard() {
  const { data: briefing } = useLiveQuery(getLatestBriefing, ['briefings'], [], 'briefing:latest');
  if (!briefing || briefing.read_at) return null;

  const today = format(new Date(), 'yyyy-MM-dd');
  const label =
    briefing.date === today
      ? 'Briefing heute'
      : `Briefing vom ${format(parseISO(briefing.date), 'EEEE, d. MMMM', { locale: de })}`;

  return (
    <Card>
      <div className="row between center" style={{ marginBottom: 10 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>{label}</div>
        <IconButton size="sm" variant="bare" label="Gelesen" onClick={() => markBriefingRead(briefing.id)}>
          <Check size={15} />
        </IconButton>
      </div>
      <Markdown>{briefing.content_md}</Markdown>
    </Card>
  );
}
