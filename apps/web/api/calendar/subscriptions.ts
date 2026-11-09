import type { ApiRequest, ApiResponse } from '../_lib/types.js';
import { admin } from '../_lib/supabaseAdmin.js';
import { verifyOwner } from '../_lib/webAuth.js';
import {
  addCalendarSubscription,
  deleteCalendarSubscription,
  IcsError,
  listCalendarSubscriptions,
  updateCalendarSubscription,
} from '../_lib/ics-bundle.js';

// Verwaltung der Kalender-Abos (read-only ICS-Links, z. B. Outlook oder ein zweites
// Google-Konto). Nur mit Owner-Sitzung, weil die Links geheim sind. Der Link geht nie
// zurück an den Client, nur als url_hint (Host plus maskiertes Ende).
//
//   GET                         → { subscriptions: CalendarSubscription[] }
//   POST   { url, name?, color?, project_id? } → { subscription }   (Link wird vorher einmal gelesen)
//   PATCH  { id, name?, color?, enabled?, url?, project_id? } → { subscription }
//
// project_id ordnet das Abo einem Larvis-Projekt zu (null löst es); die id muss ein
// bestehendes, nicht gelöschtes Projekt treffen. Die Termine des Abos tragen dann diese
// project_id und färben sich mit der Projektfarbe; color bleibt die Farbe ohne Projekt.
//   DELETE ?id=…                → { deleted }          (Soft-Delete)
//
// Fehler, die der Nutzer beheben kann (kein Kalender, Link zurückgezogen …), kommen als
// 422 mit deutscher Meldung in `error`.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!(await verifyOwner(req))) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const sb = admin();

    if (req.method === 'GET') {
      res.status(200).json({ subscriptions: await listCalendarSubscriptions(sb) });
      return;
    }

    if (req.method === 'POST') {
      const subscription = await addCalendarSubscription(sb, {
        url: typeof body.url === 'string' ? body.url : '',
        name: typeof body.name === 'string' ? body.name : null,
        color: typeof body.color === 'string' ? body.color : null,
        // Ungültige Werte (keine uuid, unbekanntes Projekt) lehnt die Prüfung mit 422 ab.
        project_id: body.project_id === undefined ? null : (body.project_id as string | null),
      });
      res.status(200).json({ subscription });
      return;
    }

    if (req.method === 'PATCH') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) {
        res.status(400).json({ error: 'id fehlt.' });
        return;
      }
      const subscription = await updateCalendarSubscription(sb, id, {
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.color === 'string' ? { color: body.color } : {}),
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(typeof body.url === 'string' ? { url: body.url } : {}),
        ...('project_id' in body ? { project_id: body.project_id as string | null } : {}),
      });
      res.status(200).json({ subscription });
      return;
    }

    if (req.method === 'DELETE') {
      const id = (typeof req.query.id === 'string' ? req.query.id : '') || (typeof body.id === 'string' ? body.id : '');
      if (!id) {
        res.status(400).json({ error: 'id fehlt.' });
        return;
      }
      await deleteCalendarSubscription(sb, id);
      res.status(200).json({ deleted: id });
      return;
    }

    res.status(405).json({ error: 'Method not allowed.' });
  } catch (e) {
    if (e instanceof IcsError) {
      res.status(422).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
