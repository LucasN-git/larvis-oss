import type { ApiRequest, ApiResponse } from '../_lib/types.js';
import { admin } from '../_lib/supabaseAdmin.js';
import { verifyOwner } from '../_lib/webAuth.js';
import { configureVapid, makeSender, type PushPayload } from '../_lib/pushSender.js';

// Test-Push an genau ein Gerät: das Gerät, von dem aus der Nutzer in den
// Einstellungen „Test senden" drückt. Prüft die ganze Kette (Abo gespeichert,
// VAPID gesetzt, Push-Dienst nimmt an) und meldet lesbar, woran es scheitert.
//
// Body: { endpoint: string } — der Push-Endpoint des eigenen Abos.

const TEST_PAYLOAD: PushPayload = {
  title: 'Larvis',
  body: 'Test: Benachrichtigungen kommen auf diesem Gerät an.',
  url: '/',
  tag: 'test',
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  if (!(await verifyOwner(req))) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const { endpoint } = (req.body ?? {}) as { endpoint?: unknown };
  if (typeof endpoint !== 'string' || !endpoint) {
    res.status(400).json({ error: 'endpoint fehlt.' });
    return;
  }

  const sb = admin();
  const { data: sub, error } = await sb
    .from('push_subscriptions')
    .select('endpoint,p256dh,auth')
    .eq('endpoint', endpoint)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!sub) {
    res.status(404).json({ error: 'Dieses Gerät ist nicht registriert.' });
    return;
  }
  if (!configureVapid()) {
    res.status(500).json({ error: 'VAPID_PRIVATE_KEY not configured' });
    return;
  }

  const sender = makeSender(sb, [sub]);
  const result = await sender.send(TEST_PAYLOAD);
  if (!result.anyDelivered) {
    // 404/410 hat der Sender das Abo bereits gelöscht.
    if (sender.state.pruned > 0) {
      res.status(410).json({ error: 'Abo abgelaufen — bitte neu aktivieren.' });
      return;
    }
    res.status(502).json({ error: `Push nicht zugestellt: ${result.error ?? 'unbekannter Fehler'}` });
    return;
  }

  // Protokoll ist Verlauf, keine Voraussetzung: ein Schreibfehler macht den Test nicht rückgängig.
  await sb
    .from('notification_log')
    .insert({ key: `test:${Date.now()}`, category: 'test', title: TEST_PAYLOAD.title, body: TEST_PAYLOAD.body });
  res.status(200).json({ ok: true });
}
