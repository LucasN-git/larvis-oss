import { Bus, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { BUS_STOP_NAME, type Departure, type OccupancyLevel } from '../../lib/transit';
import { useBusDepartures } from '../../lib/useBusDepartures';
import './transit.css';

const REFRESH_MS = 20_000;
const LIMIT = 6;

const OCC_TONE: Record<OccupancyLevel, string> = {
  0: 'occ--unknown',
  1: 'occ--low',
  2: 'occ--mid',
  3: 'occ--high',
  4: 'occ--full',
};

function whenLabel(d: Departure): string {
  if (d.minutesUntil <= 0) return 'jetzt';
  if (d.minutesUntil === 1) return '1 min';
  return `${d.minutesUntil} min`;
}

function DepartureRow({ d }: { d: Departure }) {
  return (
    <div className="bus-row">
      <span className={`bus-line ${d.line.startsWith('N') ? 'bus-line--night' : ''}`}>{d.line}</span>

      <div className="bus-row__main">
        <div className="bus-row__dest">{d.destination}</div>
        <div className="bus-row__meta">
          <span className={`occ ${OCC_TONE[d.occupancy]}`} title={d.occupancyRaw || 'keine Auslastungsdaten'}>
            <span className="occ__dot" />
            {d.occupancyLabel}
          </span>
          {d.hbfMinutes != null && d.hbfArrivalAt != null && (
            <span className="bus-row__hbf" title="Fahrzeit & Ankunft Hauptbahnhof">
              Hbf {d.hbfMinutes} min · {format(d.hbfArrivalAt, 'HH:mm')}
            </span>
          )}
        </div>
      </div>

      <div className="bus-row__when">
        <span className="bus-row__min">{whenLabel(d)}</span>
        <span className="bus-row__time">
          {format(d.expectedAt, 'HH:mm')}
          {d.delayMin > 0 && <span className="bus-row__delay"> +{d.delayMin}</span>}
        </span>
      </div>
    </div>
  );
}

export function BusCard() {
  const { deps, error, updatedAt } = useBusDepartures(REFRESH_MS);

  // Eine Gruppe: Kopf, Abfahrten als Zeilen bis zum Rand, Fußzeile mit Stand.
  return (
    <section className="group dash-card" aria-label={`Bus · ${BUS_STOP_NAME}`}>
      <div className="group__head">
        <div className="stack">
          <span>Bus · {BUS_STOP_NAME}</span>
          <span className="bus-sub">Richtung Innenstadt / Hauptbahnhof</span>
        </div>
        <Bus size={18} className="text-accent" />
      </div>

      {error && deps == null ? (
        <div className="group__empty">Abfahrten gerade nicht erreichbar.</div>
      ) : deps == null ? (
        <div className="group__empty">Lade Abfahrten …</div>
      ) : deps.length === 0 ? (
        <div className="group__empty">Keine Abfahrten in der nächsten Stunde.</div>
      ) : (
        deps.slice(0, LIMIT).map((d) => <DepartureRow key={d.id} d={d} />)
      )}

      {updatedAt && (
        <div className="group__foot bus-foot">
          <span className="row gap-xs">
            <RefreshCw size={11} /> aktualisiert {format(updatedAt, 'HH:mm:ss')}
          </span>
        </div>
      )}
    </section>
  );
}
