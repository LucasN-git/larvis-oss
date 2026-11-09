// Zeitzonen für Kalender-Abos: Wanduhrzeit + TZID → UTC.
//
// Outlook schreibt Windows-Zonennamen ("W. Europe Standard Time") statt IANA-Namen
// ("Europe/Berlin"). Beide werden hier auf eine IANA-Zone abgebildet und mit der
// Zeitzonen-Datenbank der Laufzeit (Intl) umgerechnet; das ist für jedes Jahr korrekt,
// auch wenn die VTIMEZONE-Definition im Feed nur eine Regel enthält. Was sich nicht
// abbilden lässt, rechnet der Aufrufer über die VTIMEZONE aus der Datei.

/**
 * Windows-Zonenname → IANA (CLDR windowsZones, Territorium "001"). Abgedeckt sind die
 * Zonen, die in Outlook-Feeds praktisch vorkommen; fehlt eine, greift die VTIMEZONE.
 */
const WINDOWS_TO_IANA: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indianapolis',
  'Venezuela Standard Time': 'America/Caracas',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Buenos_Aires',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Greenland Standard Time': 'America/Godthab',
  'UTC-02': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  UTC: 'Etc/UTC',
  'Coordinated Universal Time': 'Etc/UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'GTB Standard Time': 'Europe/Bucharest',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kiev',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad',
  'Jordan Standard Time': 'Asia/Amman',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Arab Standard Time': 'Asia/Riyadh',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Calcutta',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Katmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Myanmar Standard Time': 'Asia/Rangoon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Taipei Standard Time': 'Asia/Taipei',
  'W. Australia Standard Time': 'Australia/Perth',
  'Korea Standard Time': 'Asia/Seoul',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Tasmania Standard Time': 'Australia/Hobart',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Tonga Standard Time': 'Pacific/Tongatapu',
};

const validZones = new Map<string, boolean>();

function isIanaZone(name: string): boolean {
  const cached = validZones.get(name);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    ok = true;
  } catch {
    ok = false;
  }
  validZones.set(name, ok);
  return ok;
}

/**
 * IANA-Zone zu einer TZID aus einem Feed, oder null. Versteht IANA-Namen, Windows-Namen
 * und die bei manchen Exporten vorangestellten Pfade ("/mozilla.org/…/Europe/Berlin").
 */
export function resolveIanaZone(tzid: string | null | undefined): string | null {
  if (!tzid) return null;
  const name = tzid.trim().replace(/^"|"$/g, '');
  if (!name) return null;
  const windows = WINDOWS_TO_IANA[name];
  if (windows) return windows;
  if (/^(utc|gmt|z)$/i.test(name)) return 'Etc/UTC';
  if (name.includes('/') && isIanaZone(name)) return name;
  // Präfix-Pfade wie "/freeassociation.sourceforge.net/Tzfile/Europe/Berlin".
  const parts = name.split('/').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('/');
    if (isIanaZone(candidate)) return candidate;
  }
  return null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** Offset der Zone zum UTC-Zeitpunkt `ms`, in Millisekunden (Berlin im Sommer: +7 200 000). */
function zoneOffset(zone: string, ms: number): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export interface WallClock {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Wanduhrzeit in einer IANA-Zone → UTC-Millisekunden. An einer Sommerzeit-Umstellung
 * hängt das Ergebnis von der Richtung des Offsets ab: östlich von UTC landet eine
 * fehlende Uhrzeit eine Stunde später und eine doppelte nimmt die zweite (Winterzeit),
 * westlich von UTC eine Stunde früher bzw. die erste (Sommerzeit).
 */
export function wallClockToUtc(w: WallClock, zone: string): number {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const first = zoneOffset(zone, guess);
  let t = guess - first;
  const second = zoneOffset(zone, t);
  if (second !== first) t = guess - second;
  return t;
}
