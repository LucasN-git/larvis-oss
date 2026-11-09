import { ContactList } from '../features/contacts/ContactList';

/** Persönliches Adressbuch: alle Kontakte plus die Geburtstagsliste. */
export function Contacts() {
  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Kontakte</h1>
      </div>
      <ContactList />
    </div>
  );
}
