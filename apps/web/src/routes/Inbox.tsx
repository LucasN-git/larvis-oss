import { EntryList } from '../features/entries/EntryList';

export function Inbox() {
  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Inbox</h1>
      </div>
      <EntryList />
    </div>
  );
}
