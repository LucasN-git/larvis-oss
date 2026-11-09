import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Leaf, UtensilsCrossed } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  fetchDays,
  fetchMeals,
  formatPrice,
  groupByCategory,
  pickDay,
  pickHighlights,
  type Diet,
  type Meal,
} from '../../lib/mensa';
import { CANTEENS } from '../../lib/modules';
import { useCachedQuery } from '../../lib/cache';
import { Badge, Card } from '../../components/ui';
import { Drawer } from '../../components/Drawer';
import './mensa.css';

const STORAGE_KEY = 'larvis.mensaCanteen';

type BadgeTone = 'accent' | 'success' | 'warning' | 'danger';
const DIET_META: Record<NonNullable<Diet>, { label: string; tone: BadgeTone; bar: string }> = {
  vegan: { label: 'Vegan', tone: 'success', bar: 'diet--vegan' },
  vegetarisch: { label: 'Vegetarisch', tone: 'success', bar: 'diet--vegetarisch' },
  fisch: { label: 'Fisch', tone: 'accent', bar: 'diet--fisch' },
  fleisch: { label: 'Fleisch', tone: 'warning', bar: 'diet--fleisch' },
};

function dayLong(dateISO: string, todayISO: string): string {
  if (dateISO === todayISO) return 'Heute';
  return format(parseISO(dateISO), 'EEEE, d. MMMM', { locale: de });
}
function dayShort(dateISO: string, todayISO: string): string {
  if (dateISO === todayISO) return 'Heute';
  return format(parseISO(dateISO), 'EEE d.M.', { locale: de });
}

/** Eine Highlight-Zeile auf der Karte: farbiger Streifen, Art, Name, Preis. */
function HighlightLine({ meal }: { meal: Meal }) {
  const meta = meal.diet ? DIET_META[meal.diet] : null;
  return (
    <div className="mensa-line">
      <span className={clsx('mensa-line__bar', meta?.bar)} />
      <div className="mensa-line__main">
        <div className="mensa-line__kind">{meta?.label ?? 'Gericht'}</div>
        <div className="mensa-line__name">{meal.name}</div>
      </div>
      {meal.priceStudent != null && (
        <span className="mensa-line__price">{formatPrice(meal.priceStudent)}</span>
      )}
    </div>
  );
}

/** Voller Eintrag im Drawer: Name, Preise, Diät-Badge, Öko, Allergene. */
function MealRow({ m }: { m: Meal }) {
  const meta = m.diet ? DIET_META[m.diet] : null;
  return (
    <div className="mensa-meal">
      <div className="mensa-meal__head">
        <div className="mensa-meal__name">{m.name}</div>
        <div className="mensa-meal__prices">
          {m.priceStudent != null && <div className="mensa-meal__price">{formatPrice(m.priceStudent)}</div>}
          {m.priceEmployee != null && <div className="mensa-meal__price-emp">Mitarb. {formatPrice(m.priceEmployee)}</div>}
        </div>
      </div>
      <div className="mensa-meal__tags">
        {meta && <Badge tone={meta.tone}>{meta.label}</Badge>}
        {m.ecoFriendly && (
          <span className="mensa-eco mensa-eco--good">
            <Leaf size={12} /> klimafreundlich
          </span>
        )}
        {m.co2g != null && <span className="mensa-eco">{m.co2g} g CO₂</span>}
        {m.waterL != null && <span className="mensa-eco">{m.waterL} L Wasser</span>}
      </div>
      {m.allergens.length > 0 && <div className="mensa-allergens">Allergene: {m.allergens.join(', ')}</div>}
    </div>
  );
}

export function MensaCard() {
  const [canteenId, setCanteenId] = useState<number>(() => {
    const s = Number(localStorage.getItem(STORAGE_KEY));
    return CANTEENS.some((c) => c.id === s) ? s : CANTEENS[0].id;
  });
  const [date, setDate] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const todayISO = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const canteen = CANTEENS.find((c) => c.id === canteenId) ?? CANTEENS[0];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(canteenId));
  }, [canteenId]);

  // Verfügbare Tage (gecacht, revalidiert im Hintergrund).
  const { data: days, error: daysError } = useCachedQuery(`mensa:days:${canteenId}`, () => fetchDays(canteenId));

  // Starttag setzen, sobald die Tage da sind bzw. die Mensa wechselt.
  useEffect(() => {
    setDate(days ? pickDay(days, todayISO) : null);
  }, [days, canteenId, todayISO]);

  // Speiseplan für Mensa + Tag (gecacht).
  const { data: meals, error: mealsError } = useCachedQuery(
    `mensa:meals:${canteenId}:${date ?? 'none'}`,
    () => (date ? fetchMeals(canteenId, date) : Promise.resolve<Meal[]>([])),
  );
  const error = Boolean(daysError || mealsError);

  const { meat, veg } = pickHighlights(meals ?? []);

  return (
    <>
      <Card
        className="mensa"
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <div className="row between center" style={{ marginBottom: 12 }}>
          <div className="stack">
            <div className="section-title" style={{ margin: 0 }}>Mensa · {canteen.name}</div>
            <div className="mensa-sub">{date ? dayLong(date, todayISO) : 'Speiseplan'}</div>
          </div>
          <UtensilsCrossed size={18} className="text-accent" />
        </div>

        {error && meals == null ? (
          <div className="empty">Speiseplan gerade nicht erreichbar.</div>
        ) : meals == null ? (
          <div className="empty">Lädt …</div>
        ) : !meat && !veg ? (
          <div className="empty">Heute kein Speiseplan.</div>
        ) : (
          <>
            {meat && <HighlightLine meal={meat} />}
            {veg && <HighlightLine meal={veg} />}
          </>
        )}

        <div className="mensa-foot">
          <UtensilsCrossed size={11} /> Tippen für den ganzen Speiseplan
        </div>
      </Card>

      <Drawer open={open} onClose={() => setOpen(false)} title="Mensa">
        <div className="mensa-tabs">
          {CANTEENS.map((c) => (
            <button
              key={c.id}
              className="mensa-tab"
              aria-pressed={c.id === canteenId}
              onClick={() => setCanteenId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        {days && days.length > 0 && (
          <div className="mensa-days">
            {days.map((d) => (
              <button
                key={d.date}
                className="mensa-day"
                aria-pressed={d.date === date}
                disabled={d.closed}
                onClick={() => setDate(d.date)}
              >
                {dayShort(d.date, todayISO)}
              </button>
            ))}
          </div>
        )}

        {error && meals == null ? (
          <div className="empty">Speiseplan gerade nicht erreichbar.</div>
        ) : meals == null ? (
          <div className="empty">Lädt …</div>
        ) : meals.length === 0 ? (
          <div className="empty">Für diesen Tag gibt es keinen Speiseplan.</div>
        ) : (
          groupByCategory(meals).map((g) => (
            <div key={g.category} className="mensa-group">
              <div className="mensa-cat">{g.category}</div>
              {g.meals.map((m) => (
                <MealRow key={m.id} m={m} />
              ))}
            </div>
          ))
        )}
      </Drawer>
    </>
  );
}
