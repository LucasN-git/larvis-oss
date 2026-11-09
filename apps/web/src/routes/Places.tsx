import { PlacesList } from '../features/places/PlacesList';

/** Orte: Stammdaten für Termin-Orte (Fahrzeit ab dem Heimatort, Aliase zum Wiedererkennen). */
export function Places() {
  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Orte</h1>
      </div>
      <PlacesList />
    </div>
  );
}
