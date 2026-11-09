import { format } from 'date-fns';
import { fetchLocalWeather, wmoLabel } from '../../lib/weather';
import { MODULES } from '../../lib/modules';
import { useCachedQuery } from '../../lib/cache';
import { useBusDepartures } from '../../lib/useBusDepartures';
import { BUS_STOP_NAME } from '../../lib/transit';
import { countdown, type Board } from './board';

// Widgets neben der Tafel, gebaut wie die Matrix-Anzeigen am Bahnsteig. Sie folgen
// dem Theme: hell = Schild (weiße Kachel, dunkle Ziffern, Bernstein-Akzent), dunkel =
// Nachtanzeige (schwarze Kachel, bernsteinfarbene Schrift). Erste/nächste Abfahrt und
// Betriebsschluss gehören zum gewählten Tag; Wetter und Bus sind immer Live-Daten von jetzt
// und erscheinen nur, wenn ihr Modul konfiguriert ist (lib/modules.ts).

const BUS_REFRESH_MS = 30_000;

interface Props {
  today: boolean;
  board: Board;
  now: number;
}

function Led({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="led">
      <div className="led__label">{label}</div>
      {children}
    </div>
  );
}

export function BoardWidgets({ today, board, now }: Props) {

  const next = today ? board.rows.find((r) => r.state === 'upcoming') : board.rows[0];
  const nextIn = next ? countdown(next.start - now) : null;
  const lastEnd = [...board.rows, ...board.departed].reduce((max, r) => Math.max(max, r.end), 0);

  return (
    <aside className="board-widgets" aria-label="Widgets">
      <Led label={today ? 'Nächste Abfahrt' : 'Erste Abfahrt'}>
        {next ? (
          <>
            <div className="led__big">
              {today && nextIn ? (
                <>
                  {nextIn.value}
                  <small>{nextIn.unit}</small>
                </>
              ) : (
                format(next.start, 'HH:mm')
              )}
            </div>
            <div className="led__line led__line--wrap" title={next.ev.summary}>
              {next.ev.summary}
            </div>
          </>
        ) : (
          <div className="led__line">— keine —</div>
        )}
      </Led>

      <Led label="Betriebsschluss">
        <div className="led__big">{lastEnd ? format(lastEnd, 'HH:mm') : '--:--'}</div>
        <div className="led__line">
          {board.rows.length + board.departed.length} Fahrten
          {board.allDay.length > 0 && ` · ${board.allDay.length} ganzt.`}
        </div>
      </Led>

      {MODULES.weather && <WeatherLed />}
      {MODULES.bus && <BusLed now={now} />}
    </aside>
  );
}

function WeatherLed() {
  const { data: weather } = useCachedQuery('weather', fetchLocalWeather);
  return (
    <Led label="Wetter · jetzt">
      {weather ? (
        <>
          <div className="led__big">
            {Math.round(weather.now.temp)}
            <small>°C</small>
          </div>
          <div className="led__line">{wmoLabel(weather.now.code)}</div>
        </>
      ) : (
        <div className="led__line">lädt …</div>
      )}
    </Led>
  );
}

function BusLed({ now }: { now: number }) {
  const { deps, error } = useBusDepartures(BUS_REFRESH_MS);
  // Minuten gegen das laufende „jetzt" rechnen, nicht gegen den Abrufzeitpunkt.
  const buses = deps?.filter((d) => d.expectedAt > now - 30_000).slice(0, 3) ?? null;
  return (
    <Led label={`Bus ${BUS_STOP_NAME} · jetzt`}>
      {error && !buses?.length ? (
        <div className="led__line">gestört</div>
      ) : buses == null ? (
        <div className="led__line">lädt …</div>
      ) : buses.length === 0 ? (
        <div className="led__line">kein Bus</div>
      ) : (
        <ul className="led__deps">
          {buses.map((d) => {
            const min = Math.round((d.expectedAt - now) / 60_000);
            return (
              <li key={d.id}>
                <span className="led__busline">{d.line}</span>
                <span className="led__dest">{d.destination}</span>
                <span className="led__min">{min <= 0 ? 'jetzt' : `${min}'`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Led>
  );
}
