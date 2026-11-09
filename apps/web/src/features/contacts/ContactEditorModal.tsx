import { useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { BIRTHDAY_YEAR_PLACEHOLDER, type Contact, type ContactHandle } from '@larvis/shared';
import { deleteContact, upsertContact } from '../../lib/api';
import { useAutosave } from '../../lib/useAutosave';
import { useToast } from '../../lib/toast';
import { DatePicker } from '../../components/DateTimePicker';
import { Drawer } from '../../components/Drawer';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { TagInput } from '../../components/TagInput';
import { Button, IconButton, SaveStatus, Segmented, TextInput } from '../../components/ui';

interface Props {
  contact: Contact | null;
  open: boolean;
  onClose: () => void;
  /** Bereits vergebene Tags (über alle Kontakte) als Wiederverwendungs-Vorschläge. */
  tagOptions?: string[];
}

/** Mehrwertige Felder (Telefon, E-Mail, Adresse, Links): Label + Wert je Zeile. */
function HandleListEditor({
  items,
  onChange,
  valuePlaceholder,
  addLabel,
}: {
  items: ContactHandle[];
  onChange: (next: ContactHandle[]) => void;
  valuePlaceholder: string;
  addLabel: string;
}) {
  const set = (i: number, patch: Partial<ContactHandle>) =>
    onChange(items.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  return (
    <div className="stack gap-xs">
      {items.map((h, i) => (
        <div className="row gap-sm" key={i}>
          <TextInput
            placeholder="Label"
            value={h.label}
            onChange={(e) => set(i, { label: e.target.value })}
            style={{ maxWidth: 110 }}
          />
          <TextInput
            placeholder={valuePlaceholder}
            value={h.value}
            onChange={(e) => set(i, { value: e.target.value })}
          />
          <IconButton label="Entfernen" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
            <X size={14} />
          </IconButton>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onChange([...items, { label: '', value: '' }])}>
        <Plus size={14} /> {addLabel}
      </Button>
    </div>
  );
}

export function ContactEditorModal({ contact, open, onClose, tagOptions = [] }: Props) {
  const { saved } = useToast();
  const [business, setBusiness] = useState(contact?.business ?? false);
  const [firstName, setFirstName] = useState(contact?.first_name ?? '');
  const [lastName, setLastName] = useState(contact?.last_name ?? '');
  const [nickname, setNickname] = useState(contact?.nickname ?? '');
  const [birthday, setBirthday] = useState(contact?.birthday ?? '');
  const [yearUnknown, setYearUnknown] = useState(contact ? !contact.birthday_year_known : false);
  const [phones, setPhones] = useState<ContactHandle[]>(contact?.phones ?? []);
  const [emails, setEmails] = useState<ContactHandle[]>(contact?.emails ?? []);
  const [addresses, setAddresses] = useState<ContactHandle[]>(contact?.addresses ?? []);
  const [company, setCompany] = useState(contact?.company ?? '');
  const [position, setPosition] = useState(contact?.position ?? '');
  const [currentStatus, setCurrentStatus] = useState(contact?.current_status ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(contact?.linkedin_url ?? '');
  const [links, setLinks] = useState<ContactHandle[]>(
    (contact?.links ?? []).map((l) => ({ label: l.label, value: l.url })),
  );
  const [tags, setTags] = useState<string[]>(contact?.tags ?? []);
  const [notes, setNotes] = useState(contact?.notes_md ?? '');
  const idRef = useRef(contact?.id ?? null);

  const cleanHandles = (list: ContactHandle[]) =>
    list.map((h) => ({ label: h.label.trim(), value: h.value.trim() })).filter((h) => h.value);

  const { state } = useAutosave({
    value: {
      business, firstName, lastName, nickname, birthday, yearUnknown, phones, emails, addresses,
      company, position, currentStatus, linkedinUrl, links, tags, notes,
    },
    canSave: () => Boolean(firstName.trim() || lastName.trim() || nickname.trim()),
    onSaved: saved,
    onSave: async () => {
      // Jahr unbekannt → Apple-Konvention: Platzhalterjahr 1604 speichern.
      const bday = birthday
        ? yearUnknown ? `${BIRTHDAY_YEAR_PLACEHOLDER}${birthday.slice(4)}` : birthday
        : null;
      const created = await upsertContact({
        ...(idRef.current ? { id: idRef.current } : {}),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        nickname: nickname.trim() || null,
        birthday: bday,
        birthday_year_known: !yearUnknown,
        business,
        phones: cleanHandles(phones),
        emails: cleanHandles(emails),
        addresses: cleanHandles(addresses),
        company: company.trim() || null,
        position: position.trim() || null,
        current_status: currentStatus.trim(),
        linkedin_url: linkedinUrl.trim() || null,
        links: cleanHandles(links).map((l) => ({ label: l.label, url: l.value })),
        tags,
        notes_md: notes,
        source: contact?.source ?? 'manual',
      });
      idRef.current = created.id;
    },
  });

  async function remove() {
    if (contact) await deleteContact(contact.id);
    onClose();
  }

  const sectionStyle = { fontSize: 12, fontWeight: 600 } as const;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={contact ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}
      footer={
        <>
          {contact && (
            <Button variant="ghost" onClick={remove} style={{ color: 'var(--danger)', marginRight: 'auto' }}>
              <Trash2 size={16} /> Löschen
            </Button>
          )}
          <SaveStatus state={state} />
          <Button variant="primary" onClick={onClose}>
            Fertig
          </Button>
        </>
      }
    >
      <div className="stack gap-sm">
        <Segmented
          options={[
            { value: 'privat', label: 'Privat' },
            { value: 'business', label: 'Business' },
          ]}
          value={business ? 'business' : 'privat'}
          onChange={(v) => setBusiness(v === 'business')}
        />
        <div className="row gap-sm">
          <TextInput placeholder="Vorname" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <TextInput placeholder="Nachname" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <TextInput placeholder="Spitzname (optional)" value={nickname} onChange={(e) => setNickname(e.target.value)} />

        <div className="muted" style={sectionStyle}>Geburtstag</div>
        <div className="row gap-sm center">
          <DatePicker value={birthday} onChange={setBirthday} placeholder="Geburtstag wählen" />
          <label className="muted row gap-xs center" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={yearUnknown} onChange={(e) => setYearUnknown(e.target.checked)} />
            Jahr unbekannt
          </label>
        </div>

        <div className="muted" style={sectionStyle}>Telefon</div>
        <HandleListEditor items={phones} onChange={setPhones} valuePlaceholder="+49 …" addLabel="Nummer" />

        <div className="muted" style={sectionStyle}>E-Mail</div>
        <HandleListEditor items={emails} onChange={setEmails} valuePlaceholder="name@…" addLabel="E-Mail" />

        <div className="muted" style={sectionStyle}>Adresse</div>
        <HandleListEditor items={addresses} onChange={setAddresses} valuePlaceholder="Straße, PLZ Ort" addLabel="Adresse" />

        <div className="muted" style={sectionStyle}>Beruflich</div>
        <div className="row gap-sm">
          <TextInput placeholder="Firma" value={company} onChange={(e) => setCompany(e.target.value)} />
          <TextInput placeholder="Position" value={position} onChange={(e) => setPosition(e.target.value)} />
        </div>
        <TextInput
          placeholder="Macht gerade … (z. B. Master in Berlin, gründet ein Startup)"
          value={currentStatus}
          onChange={(e) => setCurrentStatus(e.target.value)}
        />

        <div className="muted" style={sectionStyle}>Links</div>
        <TextInput placeholder="LinkedIn-URL" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
        <HandleListEditor items={links} onChange={setLinks} valuePlaceholder="https://…" addLabel="Link" />

        <div className="muted" style={sectionStyle}>Tags</div>
        <TagInput value={tags} onChange={setTags} suggestions={tagOptions} />

        <div className="muted" style={sectionStyle}>Notizen</div>
        <MarkdownEditor value={notes} onChange={setNotes} placeholder="Freitext zur Person…" />
      </div>
    </Drawer>
  );
}
