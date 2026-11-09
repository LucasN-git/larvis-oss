// Optionales Modul Bus: Live-Abfahrten aus der „Busradar"-API der Stadtwerke Münster.
// Public, key-less, CORS-open (Access-Control-Allow-Origin: *), so the browser
// calls it directly — no serverless proxy needed.
//   Base:        https://rest.busradar.conterra.de/prod
//   Departures:  /haltestellen/{stopId}/abfahrten?sekunden={window}
//   Docs:        https://api.busradar.conterra.de

const BUSRADAR = 'https://rest.busradar.conterra.de/prod';

// Die Haltestelle kommt aus der Env; ohne sie ist das Modul aus (lib/modules.ts):
//   VITE_BUS_STOP_ID      Busradar-Id der Haltestelle (Steig)
//   VITE_BUS_STOP_NAME    Anzeigename, Standard: „Haltestelle"
//   VITE_BUS_HBF_MINUTES  optional, JSON { "<Linie>": <Minuten bis Hbf> }, erzeugt mit
//                         scripts/derive-bus-traveltimes.py
/** Busradar-Id des Steigs, dessen Abfahrten die App zeigt; leer = Modul aus. */
export const BUS_STOP_ID: string = import.meta.env.VITE_BUS_STOP_ID?.trim() ?? '';
/** Anzeigename der Haltestelle. */
export const BUS_STOP_NAME: string = import.meta.env.VITE_BUS_STOP_NAME || 'Haltestelle';

// Planmäßige Minuten von der Haltestelle zum Hauptbahnhof je Linie (Median über
// den GTFS-Fahrplan, siehe scripts/derive-bus-traveltimes.py). Linien, die hier
// fehlen, fahren nicht über den Hbf; ohne Angabe zeigt die App keine Ankunftszeit.
const HBF_MINUTES: Record<string, number> = parseHbfMinutes(import.meta.env.VITE_BUS_HBF_MINUTES);

function parseHbfMinutes(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** 0 = unknown, 1 = light … 4 = very full. */
export type OccupancyLevel = 0 | 1 | 2 | 3 | 4;

const OCC_LABEL: Record<OccupancyLevel, string> = {
  0: 'k. A.',
  1: 'wenig',
  2: 'mittel',
  3: 'voll',
  4: 'sehr voll',
};

function occupancyLevel(besetztgrad?: string): OccupancyLevel {
  const s = (besetztgrad ?? '').toLowerCase();
  if (s.includes('sehr stark') || s.includes('überfüllt')) return 4;
  if (s.includes('stark')) return 3;
  if (s.includes('mäßig') || s.includes('massig') || s.includes('mittel')) return 2;
  if (s.includes('schwach')) return 1;
  return 0;
}

export interface Departure {
  id: string;
  line: string;
  destination: string;
  plannedAt: number; // epoch ms
  expectedAt: number; // epoch ms (real-time)
  delayMin: number;
  minutesUntil: number;
  occupancy: OccupancyLevel;
  occupancyLabel: string;
  occupancyRaw: string;
  /** Scheduled travel time to Hauptbahnhof in minutes, or null if not via Hbf. */
  hbfMinutes: number | null;
  /** Predicted Hbf arrival (epoch ms) = expected departure + scheduled travel. */
  hbfArrivalAt: number | null;
}

interface RawDeparture {
  fahrtbezeichner: string;
  linientext: string;
  richtungstext: string;
  abfahrtszeit: number; // epoch seconds (planned)
  tatsaechliche_abfahrtszeit?: number; // epoch seconds (real-time)
  besetztgrad?: string;
}

/**
 * Next departures at a stop toward the city centre, soonest first.
 * @param withinSec look-ahead window in seconds (the API honours it directly).
 */
export async function fetchDepartures(
  stopId: string = BUS_STOP_ID,
  withinSec = 5400,
): Promise<Departure[]> {
  const res = await fetch(`${BUSRADAR}/haltestellen/${stopId}/abfahrten?sekunden=${withinSec}`);
  if (!res.ok) throw new Error(`Busradar ${res.status}`);
  const raw = (await res.json()) as RawDeparture[];
  const now = Date.now();

  return raw
    .map((d): Departure => {
      const plannedAt = d.abfahrtszeit * 1000;
      const expectedAt = (d.tatsaechliche_abfahrtszeit ?? d.abfahrtszeit) * 1000;
      const occupancy = occupancyLevel(d.besetztgrad);
      const hbfMinutes = HBF_MINUTES[d.linientext] ?? null;
      return {
        id: d.fahrtbezeichner,
        line: d.linientext,
        destination: d.richtungstext,
        plannedAt,
        expectedAt,
        delayMin: Math.round((expectedAt - plannedAt) / 60000),
        minutesUntil: Math.round((expectedAt - now) / 60000),
        occupancy,
        occupancyLabel: OCC_LABEL[occupancy],
        occupancyRaw: d.besetztgrad ?? '',
        hbfMinutes,
        hbfArrivalAt: hbfMinutes != null ? expectedAt + hbfMinutes * 60000 : null,
      };
    })
    .sort((a, b) => a.expectedAt - b.expectedAt);
}
