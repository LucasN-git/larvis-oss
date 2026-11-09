// Die Wetter-Logik (Open-Meteo) lebt in @larvis/shared, damit Web-App und MCP-Server dieselbe
// Implementierung nutzen; der Ort kommt aus der Konfiguration (lib/modules.ts).
import { fetchWeather } from '@larvis/shared';
import { WEATHER_LOCATION } from './modules';

export { wmoLabel } from '@larvis/shared';
export type { DailyForecast, WeatherNow, WeatherData } from '@larvis/shared';

/** Wetter am konfigurierten Ort. Nur aufrufen, wenn MODULES.weather an ist. */
export function fetchLocalWeather() {
  if (!WEATHER_LOCATION) return Promise.reject(new Error('Wetter nicht konfiguriert.'));
  return fetchWeather(WEATHER_LOCATION);
}
