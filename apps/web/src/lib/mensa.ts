// Die Mensa-Logik (OpenMensa-Fetch + Parsing) lebt in @larvis/shared, damit Web-App und
// MCP-Server dieselbe Implementierung nutzen; die Mensen kommen aus der Konfiguration
// (CANTEENS in lib/modules.ts).
export {
  fetchDays,
  fetchMeals,
  pickDay,
  mainMeals,
  pickHighlights,
  groupByCategory,
  formatPrice,
} from '@larvis/shared';
export type { Canteen, Diet, Meal, MensaDay } from '@larvis/shared';
