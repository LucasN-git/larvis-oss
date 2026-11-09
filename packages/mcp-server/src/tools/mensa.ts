import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fetchDays, fetchMeals, mainMeals, pickDay, type Canteen, type Meal } from '@larvis/shared';
import { fail, guard, ok } from '../util.js';

// Optionales Modul Mensa: freie OpenMensa-API (kein Key). Welche Mensen es gibt, steht in
// MENSA_CANTEENS; das Tool ist nur registriert, wenn dort mindestens eine steht.

/** Heutiges Datum in Europe/Berlin (der Server kann in UTC laufen). */
function todayBerlin(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}

function compactMeal(m: Meal) {
  return {
    name: m.name,
    category: m.category,
    diet: m.diet,
    price_student: m.priceStudent,
    price_employee: m.priceEmployee,
    allergens: m.allergens,
  };
}

async function menuFor({ id: canteenId, name }: Canteen, date: string | undefined) {
  const days = await fetchDays(canteenId);
  const resolved = date ?? pickDay(days, todayBerlin());
  if (!resolved) return { canteen: name, date: null, closed: true, meals: [] };
  const meals = await fetchMeals(canteenId, resolved);
  // Einträge ohne Preis sind Info-Texte der Mensa, keine Gerichte.
  const mains = mainMeals(meals).filter((m) => m.priceStudent != null || m.priceEmployee != null);
  return {
    canteen: name,
    date: resolved,
    is_today: resolved === todayBerlin(),
    closed: mains.length === 0,
    meals: mains.map(compactMeal),
  };
}

export function registerMensaTools(server: McpServer, canteens: Canteen[]) {
  const list = canteens.map((c) => `${c.id} (${c.name})`).join(', ');
  server.registerTool(
    'get_mensa_menu',
    {
      title: 'Get mensa menu',
      description:
        `Speiseplan der konfigurierten Mensen (OpenMensa): ${list}. Ohne canteen: alle; canteen ist die OpenMensa-Id. ` +
        'Ohne date: heute bzw. der nächste geöffnete Tag. ' +
        'Nur Hauptgerichte; diet ist vegan/vegetarisch/fisch/fleisch/null, Preise in EUR.',
      inputSchema: {
        canteen: z.number().int().positive().optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
          .optional(),
      },
    },
    async ({ canteen, date }) =>
      guard(async () => {
        if (canteen === undefined) return ok(await Promise.all(canteens.map((c) => menuFor(c, date))));
        const picked = canteens.find((c) => c.id === canteen);
        if (!picked) return fail(`Unbekannte Mensa ${canteen}. Konfiguriert: ${list}.`);
        return ok(await menuFor(picked, date));
      }),
  );
}
