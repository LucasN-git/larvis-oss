import { parseCanteens, parseWeatherLocation, type Canteen, type WeatherLocation } from '@larvis/shared';

/**
 * Optionale Module und Ortsangaben des MCP-Servers, gelesen aus der Umgebung. Jeder Name gilt
 * auch mit dem VITE_-Präfix der Web-App, damit eine gemeinsame .env reicht; der Name ohne
 * Präfix hat Vorrang, ein leerer Wert gilt als nicht gesetzt.
 *
 *   LEARNWEB_ENABLED=1            Learnweb-Tools (Moodle der Uni Münster)
 *   MENSA_CANTEENS=<id>=<Name>,…  Mensa-Tool (OpenMensa); leer = aus
 *   WEATHER_PLACE / _LAT / _LON   Ort für get_weather; fehlt einer, meldet das Tool „nicht konfiguriert"
 *   HOME_PLACE                    Heimatort als Text, ab dem die Fahrzeit zu Orten gemeint ist
 */
export interface LarvisConfig {
  learnweb: boolean;
  canteens: Canteen[];
  weather: WeatherLocation | null;
  homePlace: string | null;
}

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  return env[name]?.trim() || env[`VITE_${name}`]?.trim() || undefined;
}

const flag = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';

export function readConfig(env: Env = process.env): LarvisConfig {
  return {
    learnweb: flag(read(env, 'LEARNWEB_ENABLED')),
    canteens: parseCanteens(read(env, 'MENSA_CANTEENS')),
    weather: parseWeatherLocation(read(env, 'WEATHER_PLACE'), read(env, 'WEATHER_LAT'), read(env, 'WEATHER_LON')),
    homePlace: read(env, 'HOME_PLACE') ?? null,
  };
}
