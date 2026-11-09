// Optionales Modul Mensa: Speiseplan über die freie OpenMensa-API (kein Key, CORS-offen
// mit `Access-Control-Allow-Origin: *`, läuft direkt im Browser wie Wetter/Bus).
//   Base:   https://openmensa.org/api/v2
//   Tage:   /canteens/{id}/days            → [{ date, closed }]
//   Essen:  /canteens/{id}/days/{date}/meals
// Das Auslesen der Hinweise (Allergene, CO₂- und Wasser-Fußabdruck, Tier-Hinweise) ist auf
// die Speisepläne des Studierendenwerks Münster zugeschnitten, die ein Community-Parser in
// OpenMensa einspeist; andere Mensen liefern Gerichte und Preise, aber evtl. weniger Details.
// Welche Mensen erscheinen, steht in der Konfiguration (siehe parseCanteens); ohne sie ist
// das Modul aus.
const OPENMENSA = 'https://openmensa.org/api/v2';

export interface Canteen {
  id: number;
  name: string; // kurzer Anzeigename
}

/**
 * Mensen aus einem Konfigurationswert wie `101=Mensa Nord,102=Mensa Süd` (OpenMensa-Id, optional
 * mit Anzeigename). Die erste ist die Standard-Mensa. Ungültige Teile fallen weg; ein leerer
 * oder fehlender Wert ergibt [] (Modul aus).
 */
export function parseCanteens(spec: string | undefined): Canteen[] {
  const out: Canteen[] = [];
  for (const part of (spec ?? '').split(',')) {
    const [rawId, ...rest] = part.split('=');
    const id = Number.parseInt(rawId?.trim() ?? '', 10);
    if (!Number.isInteger(id) || id <= 0 || out.some((c) => c.id === id)) continue;
    const name = rest.join('=').trim() || `Mensa ${id}`;
    out.push({ id, name });
  }
  return out;
}

export type Diet = 'vegan' | 'vegetarisch' | 'fisch' | 'fleisch' | null;

export interface Meal {
  id: number;
  name: string; // bereinigt (Allergencodes entfernt)
  category: string; // z. B. "Hauptkomponenten", "Beilagen"
  priceStudent: number | null;
  priceEmployee: number | null;
  diet: Diet;
  allergens: string[]; // lesbar, z. B. ["Weizen", "Ei", "Milch"]
  co2g: number | null; // CO₂ pro Portion in Gramm
  waterL: number | null; // Wasserverbrauch pro Portion in Litern
  ecoFriendly: boolean; // Hinweis "mind. 50% weniger CO₂"
}

export interface MensaDay {
  date: string; // YYYY-MM-DD
  closed: boolean;
}

interface RawMeal {
  id: number;
  name: string;
  category: string;
  prices: { students: number | null; employees: number | null; pupils: number | null; others: number | null };
  notes: string[];
}

// Tier-Hinweise stehen im Klartext in den Notes ("mit Geflügel") oder im Namen.
const FISH_WORDS = ['fisch', 'lachs', 'thunfisch', 'seelachs', 'garnele', 'shrimp', 'krabbe', 'scampi', 'meeresfrüchte', 'hering', 'pangasius', 'forelle'];
const MEAT_WORDS = ['geflügel', 'schwein', 'rind', 'kalb', 'lamm', 'wild', 'pute', 'ente', 'huhn', 'hähnchen', 'fleisch', 'wurst', 'speck', 'schinken', 'hack', 'gyros', 'döner', 'salami'];

// Beilagen, Suppen, Desserts etc. zählen nicht als Hauptgericht.
const SIDE_RE = /beilage|dessert|nachtisch|salat|suppe|vorspeise|extra|snack|dazu|topping|sauce/i;

// Allergencodes aus dem Namen schneiden:
// "Farfalle (AWE) mit Pesto (C,G,HWA)" → "Farfalle mit Pesto".
function cleanName(name: string): string {
  return name
    .replace(/\([A-ZÄÖÜ0-9][A-ZÄÖÜ0-9,\s]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function classifyDiet(notes: string[], name: string): Diet {
  const tags = notes.map((n) => n.toLowerCase().trim());
  if (tags.includes('vegan')) return 'vegan';
  if (tags.includes('vegetarisch')) return 'vegetarisch';
  const hay = `${tags.join(' ')} ${name.toLowerCase()}`;
  if (FISH_WORDS.some((w) => hay.includes(w))) return 'fisch';
  if (MEAT_WORDS.some((w) => hay.includes(w))) return 'fleisch';
  return null;
}

// Notes tragen Allergene ("AWE) enthält Weizen*", "1) mit Farbstoff") sowie
// CO₂-/Wasser-Fußabdruck. Diät-Tags ("vegan", "mit Geflügel") matchen keinen
// Zweig und werden hier ignoriert (separat über classifyDiet erfasst).
function parseNotes(notes: string[]): Pick<Meal, 'allergens' | 'co2g' | 'waterL' | 'ecoFriendly'> {
  const allergens: string[] = [];
  let co2g: number | null = null;
  let waterL: number | null = null;
  let ecoFriendly = false;

  for (const note of notes) {
    const t = note.trim();
    if (/50\s*%\s*weniger\s*CO/i.test(t)) {
      ecoFriendly = true;
      continue;
    }
    const co2 = t.match(/Fußabdruck pro Portion:\s*([\d.,]+)\s*g/i);
    if (co2) {
      co2g = Math.round(parseFloat(co2[1].replace(',', '.')));
      continue;
    }
    const water = t.match(/([\d.,]+)\s*Liter Wasser/i);
    if (water) {
      waterL = parseFloat(water[1].replace(',', '.'));
      continue;
    }
    const al = t.match(/^[A-ZÄÖÜ0-9]+\)\s*(.+)$/);
    if (al) {
      const label = al[1]
        .replace(/^enthält\s+/i, '')
        .replace(/^mit\s+/i, '')
        .replace(/\*+$/, '')
        .trim();
      if (label) allergens.push(label);
    }
  }
  return { allergens, co2g, waterL, ecoFriendly };
}

function parseMeal(raw: RawMeal): Meal {
  const notes = raw.notes ?? [];
  return {
    id: raw.id,
    name: cleanName(raw.name),
    category: raw.category,
    priceStudent: raw.prices?.students ?? null,
    priceEmployee: raw.prices?.employees ?? null,
    diet: classifyDiet(notes, raw.name),
    ...parseNotes(notes),
  };
}

export async function fetchDays(canteenId: number): Promise<MensaDay[]> {
  const res = await fetch(`${OPENMENSA}/canteens/${canteenId}/days`);
  if (!res.ok) throw new Error(`OpenMensa days ${res.status}`);
  return (await res.json()) as MensaDay[];
}

export async function fetchMeals(canteenId: number, date: string): Promise<Meal[]> {
  const res = await fetch(`${OPENMENSA}/canteens/${canteenId}/days/${date}/meals`);
  if (res.status === 404) return []; // Tag ohne Speiseplan / geschlossen
  if (!res.ok) throw new Error(`OpenMensa meals ${res.status}`);
  const raw = (await res.json()) as RawMeal[];
  return raw.map(parseMeal);
}

/** Welcher Tag wird gezeigt: heute, wenn offen, sonst der nächste offene Tag. */
export function pickDay(days: MensaDay[], todayISO: string): string | null {
  const open = days.filter((d) => !d.closed);
  if (!open.length) return null;
  return (open.find((d) => d.date === todayISO) ?? open.find((d) => d.date >= todayISO) ?? open[0]).date;
}

/** Hauptgerichte (ohne Beilagen/Suppen/Desserts). */
export function mainMeals(meals: Meal[]): Meal[] {
  const mains = meals.filter((m) => !SIDE_RE.test(m.category));
  return mains.length ? mains : meals;
}

/** Das (wechselnde) Fleisch-/Fisch-Gericht und das vegetarische Gericht des Tages. */
export function pickHighlights(meals: Meal[]): { meat: Meal | null; veg: Meal | null } {
  const pool = mainMeals(meals);
  return {
    meat: pool.find((m) => m.diet === 'fleisch' || m.diet === 'fisch') ?? null,
    veg: pool.find((m) => m.diet === 'vegan' || m.diet === 'vegetarisch') ?? null,
  };
}

/** Gerichte nach Kategorie gruppieren, Reihenfolge wie geliefert. */
export function groupByCategory(meals: Meal[]): { category: string; meals: Meal[] }[] {
  const order: string[] = [];
  const map = new Map<string, Meal[]>();
  for (const m of meals) {
    if (!map.has(m.category)) {
      map.set(m.category, []);
      order.push(m.category);
    }
    map.get(m.category)!.push(m);
  }
  return order.map((category) => ({ category, meals: map.get(category)! }));
}

export function formatPrice(p: number | null): string | null {
  if (p == null) return null;
  return p.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
