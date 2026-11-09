import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fetchWeather, wmoLabel, type WeatherLocation } from '@larvis/shared';
import { fail, guard, ok } from '../util.js';

// Wetter am konfigurierten Ort (WEATHER_PLACE, WEATHER_LAT, WEATHER_LON). Das Tool ist immer
// registriert; ohne Ort antwortet es mit dem Hinweis, wie man ihn einträgt.
export function registerWeatherTools(server: McpServer, location: WeatherLocation | null) {
  server.registerTool(
    'get_weather',
    {
      title: 'Get weather',
      description:
        `Aktuelles Wetter und Tagesvorhersage ${location ? `für ${location.name}` : 'am konfigurierten Ort'} (Open-Meteo). ` +
        'days begrenzt die Vorhersage (1–7, Standard 7); Tag 1 ist heute. Ohne konfigurierten Ort meldet das Tool „nicht konfiguriert".',
      inputSchema: { days: z.number().int().min(1).max(7).optional() },
    },
    async ({ days }) =>
      guard(async () => {
        if (!location) {
          return fail('Wetter nicht konfiguriert: WEATHER_PLACE, WEATHER_LAT und WEATHER_LON in der Umgebung des MCP-Servers setzen.');
        }
        const w = await fetchWeather(location);
        return ok({
          location: location.name,
          now: {
            temp_c: w.now.temp,
            feels_like_c: w.now.feelsLike,
            condition: wmoLabel(w.now.code),
            humidity_pct: w.now.humidity,
            wind_kmh: w.now.wind,
          },
          daily: w.daily.slice(0, days ?? 7).map((d) => ({
            date: d.date,
            condition: wmoLabel(d.code),
            t_max_c: d.tMax,
            t_min_c: d.tMin,
            precip_prob_pct: d.precipProb,
          })),
        });
      }),
  );
}
