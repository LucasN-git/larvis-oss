// Kostenloses Wetter für einen konfigurierten Ort. Wird von der Web-App und den
// MCP-Tools gemeinsam genutzt. Primär Open-Meteo (kein API-Key, CORS-fähig);
// aus Rechenzentren drosselt Open-Meteo teils per IP — dann springt BrightSky
// (DWD-Daten, nur Deutschland, ebenfalls frei + CORS) als Fallback ein.
// Ohne konfigurierten Ort gibt es kein Wetter: die App blendet das Widget aus, das
// MCP-Tool meldet „nicht konfiguriert".

/** Ort für das Wetter: Anzeigename plus Koordinaten (WGS84, Dezimalgrad). */
export interface WeatherLocation {
  name: string;
  lat: number;
  lon: number;
}

const num = (v: string | undefined) => {
  const s = v?.trim().replace(',', '.');
  return s ? Number(s) : NaN;
};

/**
 * Ort aus Konfigurationswerten (Name, Breite, Länge als Text). null, wenn einer fehlt oder
 * die Koordinaten keine gültigen Zahlen im erlaubten Bereich sind.
 */
export function parseWeatherLocation(
  name: string | undefined,
  lat: string | undefined,
  lon: string | undefined,
): WeatherLocation | null {
  const n = name?.trim();
  const la = num(lat);
  const lo = num(lon);
  if (!n || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return { name: n, lat: la, lon: lo };
}

export interface DailyForecast {
  date: string; // YYYY-MM-DD (lokale Zeitzone Europe/Berlin)
  code: number; // WMO weather code
  tMax: number;
  tMin: number;
  precipProb: number | null; // max. Niederschlagswahrscheinlichkeit in %
}

export interface WeatherNow {
  temp: number;
  feelsLike: number;
  code: number;
  humidity: number;
  wind: number; // km/h
}

export interface WeatherData {
  now: WeatherNow;
  daily: DailyForecast[];
}

interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max?: (number | null)[];
  };
}

interface BrightSkyHour {
  timestamp: string; // ISO mit Berlin-Offset
  temperature: number | null;
  precipitation_probability: number | null;
  icon: string | null;
}

interface BrightSkyCurrent {
  weather: {
    temperature: number | null;
    relative_humidity: number | null;
    wind_speed_10: number | null; // km/h
    icon: string | null;
  };
}

/** WMO weather code → deutscher Kurztext (Icon-Mapping lebt in der UI). */
export function wmoLabel(code: number): string {
  if (code === 0) return 'Klar';
  if (code === 1 || code === 2) return 'Heiter';
  if (code === 3) return 'Bewölkt';
  if (code === 45 || code === 48) return 'Nebel';
  if (code >= 51 && code <= 57) return 'Niesel';
  if (code >= 61 && code <= 67) return 'Regen';
  if (code >= 71 && code <= 77) return 'Schnee';
  if (code >= 80 && code <= 82) return 'Schauer';
  if (code === 85 || code === 86) return 'Schneeschauer';
  if (code >= 95) return 'Gewitter';
  return 'Wechselhaft';
}

/** BrightSky-Icon → grober WMO-Code, damit wmoLabel/UI-Icons weiter greifen. */
const BRIGHTSKY_WMO: Record<string, number> = {
  'clear-day': 0,
  'clear-night': 0,
  'partly-cloudy-day': 2,
  'partly-cloudy-night': 2,
  cloudy: 3,
  wind: 3,
  fog: 45,
  rain: 61,
  sleet: 66,
  snow: 71,
  hail: 77,
  thunderstorm: 95,
};

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Fehlertext inkl. cause — undicis „fetch failed" allein sagt sonst nichts. */
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as Error & { cause?: unknown }).cause;
  if (!cause) return e.message;
  return `${e.message} (${cause instanceof Error ? cause.message : String(cause)})`;
}

/** YYYY-MM-DD in Europe/Berlin, offsetDays Tage ab heute. */
function berlinDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(d);
}

async function fetchOpenMeteo({ lat, lon }: WeatherLocation): Promise<WeatherData> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&timezone=Europe%2FBerlin&forecast_days=7' +
    '&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max';

  // Kurzer Timeout: wenn Open-Meteo die IP drosselt, hängt der Connect sonst
  // bis zum Function-Timeout, bevor der Fallback drankommt.
  const j = await fetchJson<OpenMeteoResponse>(url, 5000);

  const d = j.daily;
  const daily: DailyForecast[] = d.time.map((date: string, i: number) => ({
    date,
    code: d.weather_code[i],
    tMax: Math.round(d.temperature_2m_max[i]),
    tMin: Math.round(d.temperature_2m_min[i]),
    precipProb: d.precipitation_probability_max?.[i] ?? null,
  }));

  return {
    now: {
      temp: Math.round(j.current.temperature_2m),
      feelsLike: Math.round(j.current.apparent_temperature),
      code: j.current.weather_code,
      humidity: Math.round(j.current.relative_humidity_2m),
      wind: Math.round(j.current.wind_speed_10m),
    },
    daily,
  };
}

async function fetchBrightSky({ lat, lon }: WeatherLocation): Promise<WeatherData> {
  const loc = `lat=${lat}&lon=${lon}&tz=Europe%2FBerlin`;
  const [cur, range] = await Promise.all([
    fetchJson<BrightSkyCurrent>(`https://api.brightsky.dev/current_weather?${loc}`, 8000),
    fetchJson<{ weather: BrightSkyHour[] }>(
      `https://api.brightsky.dev/weather?${loc}&date=${berlinDate()}&last_date=${berlinDate(7)}`,
      8000,
    ),
  ]);

  const byDay = new Map<string, BrightSkyHour[]>();
  for (const h of range.weather) {
    const day = h.timestamp.slice(0, 10);
    const hours = byDay.get(day);
    if (hours) hours.push(h);
    else byDay.set(day, [h]);
  }

  const daily: DailyForecast[] = [...byDay.entries()]
    .filter(([, hours]) => hours.some((h) => h.temperature != null))
    .slice(0, 7)
    .map(([date, hours]) => {
      const temps = hours.map((h) => h.temperature).filter((t): t is number => t != null);
      const probs = hours
        .map((h) => h.precipitation_probability)
        .filter((p): p is number => p != null);
      return {
        date,
        // Tages-Code = schlechteste Stunde, wie Open-Meteos daily weather_code.
        code: Math.max(0, ...hours.map((h) => BRIGHTSKY_WMO[h.icon ?? ''] ?? 0)),
        tMax: Math.round(Math.max(...temps)),
        tMin: Math.round(Math.min(...temps)),
        precipProb: probs.length ? Math.max(...probs) : null,
      };
    });

  const w = cur.weather;
  if (w.temperature == null) throw new Error('BrightSky ohne aktuelle Temperatur');
  return {
    now: {
      temp: Math.round(w.temperature),
      feelsLike: Math.round(w.temperature), // BrightSky hat keine gefühlte Temperatur
      code: BRIGHTSKY_WMO[w.icon ?? ''] ?? 3,
      humidity: Math.round(w.relative_humidity ?? 0),
      wind: Math.round(w.wind_speed_10 ?? 0),
    },
    daily,
  };
}

export async function fetchWeather(location: WeatherLocation): Promise<WeatherData> {
  try {
    return await fetchOpenMeteo(location);
  } catch (om) {
    try {
      return await fetchBrightSky(location);
    } catch (bs) {
      throw new Error(
        `Wetter nicht abrufbar. Open-Meteo: ${describeError(om)} / BrightSky: ${describeError(bs)}`,
      );
    }
  }
}
