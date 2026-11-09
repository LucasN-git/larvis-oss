import { useState } from 'react';
import { Cake, Linkedin, Plus } from 'lucide-react';
import { contactName, upcomingBirthday, type Contact } from '@larvis/shared';
import { listContacts } from '../../lib/api';
import { useLiveQuery } from '../../lib/useLive';
import { Button, Chip, Segmented, TextInput } from '../../components/ui';
import { ContactEditorModal } from './ContactEditorModal';

type View = 'alle' | 'privat' | 'business' | 'geburtstage';

function initials(c: Contact): string {
  const name = contactName(c);
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** "07.03." bzw. "07.03.2005" wenn das Jahr bekannt ist. */
function formatBirthday(c: Contact): string {
  if (!c.birthday) return '';
  const [y, m, d] = c.birthday.split('-');
  return c.birthday_year_known ? `${d}.${m}.${y}` : `${d}.${m}.`;
}

export function ContactList() {
  const [view, setView] = useState<View>('alle');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const { data: contacts, loading } = useLiveQuery(listContacts, ['contacts'], [], 'contacts');

  // Alle bereits vergebenen Tags: Filterleiste hier + Vorschläge im Editor.
  const allTags = Array.from(new Set((contacts ?? []).flatMap((c) => c.tags))).sort((a, b) =>
    a.localeCompare(b, 'de'),
  );

  const q = query.trim().toLowerCase();
  const matches = (c: Contact) =>
    (view !== 'privat' || !c.business) &&
    (view !== 'business' || c.business) &&
    (!tagFilter || c.tags.includes(tagFilter)) &&
    (!q ||
      contactName(c).toLowerCase().includes(q) ||
      (c.nickname ?? '').toLowerCase().includes(q) ||
      (c.company ?? '').toLowerCase().includes(q) ||
      c.current_status.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q)));

  let rows = (contacts ?? []).filter(matches);
  if (view === 'geburtstage') {
    rows = rows
      .filter((c) => c.birthday)
      .sort((a, b) => (upcomingBirthday(a)?.daysUntil ?? 999) - (upcomingBirthday(b)?.daysUntil ?? 999));
  }

  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack gap-md">
      <Segmented
        options={[
          { value: 'alle' as View, label: 'Alle' },
          { value: 'privat' as View, label: 'Privat' },
          { value: 'business' as View, label: 'Business' },
          { value: 'geburtstage' as View, label: 'Geburtstage' },
        ]}
        value={view}
        onChange={setView}
      />

      <div className="quick-add">
        <TextInput placeholder="Kontakte durchsuchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="primary" onClick={() => setCreating(true)} aria-label="Neuer Kontakt">
          <Plus size={18} />
        </Button>
      </div>

      {allTags.length > 0 && (
        <div className="row wrap gap-xs">
          {allTags.map((t) => {
            const active = tagFilter === t;
            return (
              <button
                type="button"
                key={t}
                className={active ? 'chip chip--active' : 'chip'}
                onClick={() => setTagFilter(active ? null : t)}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}

      {rows.length === 0 && !loading && (
        <div className="empty">
          {q || tagFilter
            ? 'Nichts gefunden.'
            : view === 'geburtstage'
              ? 'Noch keine Kontakte mit Geburtstag.'
              : view === 'privat'
                ? 'Noch keine privaten Kontakte.'
                : view === 'business'
                  ? 'Noch keine Business-Kontakte.'
                  : 'Noch keine Kontakte.'}
        </div>
      )}

      {rows.length > 0 && (
        <div className="group group--tile">
          {rows.map((c) => {
            const bd = upcomingBirthday(c);
            const work = [c.position, c.company].filter(Boolean).join(' · ');
            const sub =
              view === 'geburtstage' && bd
                ? `${formatBirthday(c)} · ${bd.daysUntil === 0 ? 'heute!' : `in ${bd.daysUntil} Tagen`}${bd.turnsAge ? ` · wird ${bd.turnsAge}` : ''}`
                : c.current_status || work || c.emails[0]?.value || c.phones[0]?.value || '';
            return (
              <button key={c.id} className="item-row" style={{ textAlign: 'left' }} onClick={() => setEditing(c)}>
                <div className="icon-tile icon-tile--sm" style={{ borderRadius: '50%', fontSize: 11, fontWeight: 600 }}>
                  {initials(c)}
                </div>
                <div className="item-row__main">
                  <div className="item-row__title">{contactName(c)}</div>
                  {sub && <div className="item-row__sub">{sub}</div>}
                </div>
                {view === 'alle' && <Chip>{c.business ? 'Business' : 'Privat'}</Chip>}
                {view !== 'geburtstage' && c.birthday && (
                  <Chip>
                    <Cake size={12} /> {formatBirthday(c)}
                  </Chip>
                )}
                {c.linkedin_url && (
                  <Chip>
                    <Linkedin size={12} />
                  </Chip>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loading && (
        <div className="muted" style={{ fontSize: 13 }}>
          {rows.length} {rows.length === 1 ? 'Kontakt' : 'Kontakte'}
          {view === 'geburtstage' ? ' mit Geburtstag' : ''}
        </div>
      )}

      {creating && <ContactEditorModal contact={null} open onClose={() => setCreating(false)} tagOptions={allTags} />}
      {editing && <ContactEditorModal contact={editing} open onClose={() => setEditing(null)} tagOptions={allTags} />}
    </div>
  );
}
