import type { Place } from '@larvis/shared';

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Ordnet einen Freitext-Ort einem Larvis-Ort zu: exakter Treffer auf Name oder
 * Alias, ohne Groß-/Kleinschreibung und Rand-Leerzeichen. Gelöschte Orte zählen
 * nicht. Teiltreffer gibt es bewusst nicht — „Kunde Halle 3“ ist kein Treffer für „Kunde“.
 */
export function matchPlace(location: string | null | undefined, places: readonly Place[]): Place | null {
  const needle = norm(location ?? '');
  if (!needle) return null;
  const live = places.filter((p) => !p.deleted_at);
  return (
    live.find((p) => norm(p.name) === needle) ??
    live.find((p) => p.aliases.some((a) => norm(a) === needle)) ??
    null
  );
}

/** „Kunde Beispielstadt · 60 min Fahrt“ bzw. nur der Name, wenn die Fahrzeit unbekannt ist. */
export function placeHint(place: Place): string {
  return place.travel_minutes != null ? `${place.name} · ${place.travel_minutes} min Fahrt` : place.name;
}
