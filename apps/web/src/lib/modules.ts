// Optionale Module und Ortsangaben der Web-App, aus der Build-Konfiguration (VITE_*, siehe
// apps/web/.env.example). Ein Modul ist aus, solange seine Konfiguration fehlt: dann zeigt die
// App weder Karte noch Tab noch Navigationseintrag dafür.
//
//   VITE_WEATHER_PLACE / _LAT / _LON   Wetter am eigenen Ort (Widget auf Heute, Tafel, Dashboard)
//   VITE_HOME_PLACE                    Heimatort als Text, ab dem die Fahrzeit zu Orten gemeint ist
//   VITE_LEARNWEB_ENABLED=1            Learnweb (Moodle der Uni Münster)
//   VITE_MENSA_CANTEENS=<id>=<Name>,…  Mensa (OpenMensa, Studierendenwerk Münster)
//   VITE_BUS_STOP_ID                   Bus-Abfahrten (Busradar der Stadtwerke Münster)
import { parseCanteens, parseWeatherLocation, type Canteen, type WeatherLocation } from '@larvis/shared';

const env = import.meta.env;
const flag = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';

/** Ort für das Wetter; null = kein Wetter-Widget. */
export const WEATHER_LOCATION: WeatherLocation | null = parseWeatherLocation(
  env.VITE_WEATHER_PLACE,
  env.VITE_WEATHER_LAT,
  env.VITE_WEATHER_LON,
);

/** Konfigurierte Mensen, die erste ist Standard; leer = Mensa-Modul aus. */
export const CANTEENS: Canteen[] = parseCanteens(env.VITE_MENSA_CANTEENS);

/** Heimatort als Anzeigetext (nur Text, keine Koordinaten); null = „Heimatort". */
export const HOME_PLACE: string | null = env.VITE_HOME_PLACE?.trim() || null;

export const MODULES = {
  weather: WEATHER_LOCATION !== null,
  learnweb: flag(env.VITE_LEARNWEB_ENABLED),
  mensa: CANTEENS.length > 0,
  bus: Boolean(env.VITE_BUS_STOP_ID?.trim()),
} as const;
