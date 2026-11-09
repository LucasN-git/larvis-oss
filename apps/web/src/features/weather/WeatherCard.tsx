import { useEffect } from 'react';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { fetchLocalWeather, type DailyForecast } from '../../lib/weather';
import { WEATHER_LOCATION } from '../../lib/modules';
import { useCachedQuery } from '../../lib/cache';
import { Card } from '../../components/ui';

interface CodeInfo {
  Icon: LucideIcon;
  label: string;
}

// WMO weather codes → Icon + deutscher Kurztext. (Auch vom TV-Dashboard genutzt.)
export function codeInfo(code: number): CodeInfo {
  if (code === 0) return { Icon: Sun, label: 'Klar' };
  if (code === 1 || code === 2) return { Icon: CloudSun, label: 'Heiter' };
  if (code === 3) return { Icon: Cloud, label: 'Bewölkt' };
  if (code === 45 || code === 48) return { Icon: CloudFog, label: 'Nebel' };
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, label: 'Niesel' };
  if (code >= 61 && code <= 67) return { Icon: CloudRain, label: 'Regen' };
  if (code >= 71 && code <= 77) return { Icon: CloudSnow, label: 'Schnee' };
  if (code >= 80 && code <= 82) return { Icon: CloudRain, label: 'Schauer' };
  if (code === 85 || code === 86) return { Icon: CloudSnow, label: 'Schneeschauer' };
  if (code >= 95) return { Icon: CloudLightning, label: 'Gewitter' };
  return { Icon: Cloud, label: 'Wechselhaft' };
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function weekday(date: string): string {
  // date ist lokal (Europe/Berlin); Mittags-Parsing umgeht Zeitzonen-Kanten.
  return WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
}

function BigDay({ label, big, day }: { label: string; big: number; day: DailyForecast }) {
  const { Icon, label: cond } = codeInfo(day.code);
  return (
    <div className="wx-big">
      <div className="wx-big__label">{label}</div>
      <Icon size={46} strokeWidth={1.5} className="wx-big__icon" />
      <div className="wx-big__temp">{big}°</div>
      <div className="wx-big__cond">{cond}</div>
      <div className="wx-big__range">
        {day.tMax}°<small> / {day.tMin}°</small>
      </div>
      {day.precipProb != null && day.precipProb >= 10 && (
        <div className="wx-big__precip">
          <Droplets size={13} /> {day.precipProb}%
        </div>
      )}
    </div>
  );
}

export function WeatherCard() {
  const { data, error, refetch } = useCachedQuery('weather', fetchLocalWeather);

  useEffect(() => {
    const id = setInterval(() => void refetch(), 1000 * 60 * 15); // alle 15 min aktualisieren
    return () => clearInterval(id);
  }, [refetch]);

  const nowInfo = data && codeInfo(data.now.code);

  return (
    <Card className="wx">
      <div className="row between center" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>Wetter · {WEATHER_LOCATION?.name}</div>
        {data && nowInfo && (
          <div className="row gap-xs center text-muted" style={{ fontSize: 13 }}>
            <nowInfo.Icon size={16} />
            <span>gefühlt {data.now.feelsLike}°</span>
          </div>
        )}
      </div>

      {error && !data ? (
        <div className="empty">Wetter gerade nicht verfügbar.</div>
      ) : !data ? (
        <div className="text-muted" style={{ fontSize: 14 }}>Lädt …</div>
      ) : (
        <>
          <div className="wx-bigrow">
            <BigDay label="Heute" big={data.now.temp} day={data.daily[0]} />
            <BigDay label="Morgen" big={data.daily[1].tMax} day={data.daily[1]} />
          </div>

          <div className="wx-forecast">
            {data.daily.slice(2, 7).map((d) => {
              const { Icon } = codeInfo(d.code);
              return (
                <div key={d.date} className="wx-day">
                  <div className="wx-day__name">{weekday(d.date)}</div>
                  <Icon size={20} strokeWidth={1.7} className="wx-day__icon" />
                  <div className="wx-day__max">{d.tMax}°</div>
                  <div className="wx-day__min">{d.tMin}°</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
