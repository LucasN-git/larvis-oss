import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Place } from '@larvis/shared';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';
import type { LarvisConfig } from '../config.js';

const COLS = 'id,name,address,city,travel_minutes,notes_md,aliases,created_at,updated_at,deleted_at';

function matches(p: Place, q: string): boolean {
  const needle = q.toLowerCase();
  return [p.name, p.city, ...p.aliases].some((s) => s.toLowerCase().includes(needle));
}

export function registerPlaceTools(server: McpServer, config: Pick<LarvisConfig, 'homePlace'>) {
  // Fahrzeiten zählen ab dem Heimatort; sein Name steht nur als Text in der Konfiguration.
  const from = config.homePlace ? `ab dem Heimatort (${config.homePlace})` : 'ab dem Heimatort';
  server.registerTool(
    'list_places',
    {
      title: 'List places',
      description:
        `Listet die Orte (Stammdaten für Termin-Orte), sortiert nach Name; query sucht ohne Groß-/Kleinschreibung in Name, Aliasen und Stadt. travel_minutes ist die Auto-Fahrzeit ${from} (null = unbekannt oder innerorts) und bestimmt, wie früh die Erinnerung an einen Termin dort kommt.`,
      inputSchema: {
        query: z.string().optional(),
        include_deleted: z.boolean().optional(),
      },
    },
    async ({ query, include_deleted }) =>
      guard(async () => {
        let q = db.from('places').select(COLS);
        if (!include_deleted) q = q.is('deleted_at', null);
        const rows = unwrap(await q.order('name')) as unknown as Place[];
        const trimmed = query?.trim();
        return ok(trimmed ? rows.filter((p) => matches(p, trimmed)) : rows);
      }),
  );

  server.registerTool(
    'upsert_place',
    {
      title: 'Upsert place',
      description:
        `Legt einen Ort an oder ändert ihn: mit id wird dieser Ort geändert, ohne id wird ein lebender Ort gleichen Namens (ohne Groß-/Kleinschreibung) aktualisiert statt doppelt angelegt. travel_minutes ist die Auto-Fahrzeit ${from} in ganzen Minuten (null = unbekannt oder innerorts), aliases sind weitere Namen zum Wiedererkennen in Termin-Locations.`,
      inputSchema: {
        id: z.string().optional(),
        name: z.string().min(1),
        address: z.string().optional(),
        city: z.string().optional(),
        travel_minutes: z.number().int().min(0).nullable().optional(),
        notes_md: z.string().optional(),
        aliases: z.array(z.string()).optional(),
      },
    },
    async ({ id, ...fields }) =>
      guard(async () => {
        let targetId = id ?? null;
        if (!targetId) {
          // ilike without wildcards = case-insensitive equality; escape LIKE metacharacters.
          const pattern = fields.name.replace(/[\\%_]/g, (c) => `\\${c}`);
          const { data } = await db
            .from('places')
            .select('id')
            .is('deleted_at', null)
            .ilike('name', pattern)
            .maybeSingle();
          targetId = data?.id ?? null;
        }
        const row = targetId
          ? unwrap(await db.from('places').update(fields).eq('id', targetId).select(COLS).single())
          : unwrap(await db.from('places').insert(fields).select(COLS).single());
        return ok(row);
      }),
  );

  server.registerTool(
    'delete_place',
    {
      title: 'Delete place',
      description: 'Löscht einen Ort weich (deleted_at); mit restore_place wiederherstellbar.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('places').update({ deleted_at: new Date().toISOString() }).eq('id', id));
        return ok({ deleted: id });
      }),
  );

  server.registerTool(
    'restore_place',
    {
      title: 'Restore place',
      description:
        'Holt einen weich gelöschten Ort zurück. Scheitert, wenn inzwischen ein lebender Ort mit gleichem Namen existiert.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('places').update({ deleted_at: null }).eq('id', id));
        return ok({ restored: id });
      }),
  );
}
