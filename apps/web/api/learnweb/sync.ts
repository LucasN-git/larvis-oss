import type { ApiRequest, ApiResponse } from '../_lib/types.js';
import { admin } from '../_lib/supabaseAdmin.js';
import { verifyOwner } from '../_lib/webAuth.js';
import { learnwebEnabled } from '../_lib/modules.js';
import { LearnwebAuthError, LearnwebMaintenanceError, syncLearnweb } from '../_lib/learnweb-bundle.js';

// Löst einen Learnweb-Sync aus (read-only gegenüber Learnweb: Login + GETs + die
// zwei erlaubten Lese-AJAX-Methoden; alle Writes gehen in die learnweb_*-Tabellen).
// Nur der Owner darf auslösen (dieser Endpoint loggt sich mit echten SSO-Daten ein).
//
// Body: { course_id?: number }  — optional nur einen Kurs tief syncen.
// Hinweis: Der ERSTE Voll-Sync (alle Episoden-Seiten) kann die Function-Laufzeit
// sprengen; ihn besser einmalig lokal über scripts/learnweb/sync-local.mjs fahren.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!learnwebEnabled()) {
    res.status(404).json({ error: 'Learnweb-Modul ist nicht eingeschaltet.' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  if (!(await verifyOwner(req))) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const body = (req.body ?? {}) as { course_id?: number };
  const courseId = typeof body.course_id === 'number' ? body.course_id : undefined;

  try {
    const report = await syncLearnweb(admin(), { courseId, skipUnchanged: true });
    res.status(200).json({ report });
  } catch (e) {
    // Auth-/Wartungsfehler sind erwartbar und tragen eine lesbare deutsche
    // Meldung (nie Credentials) → 503, damit das UI sie als Toast zeigen kann.
    if (e instanceof LearnwebAuthError || e instanceof LearnwebMaintenanceError) {
      res.status(503).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
