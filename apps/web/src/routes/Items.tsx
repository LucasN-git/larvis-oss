import { ItemsList } from '../features/items/ItemsList';

export function Items() {
  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Dinge</h1>
      </div>
      <ItemsList />
    </div>
  );
}
