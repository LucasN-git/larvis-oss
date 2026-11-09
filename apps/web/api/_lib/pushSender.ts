import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@larvis/shared';
import webpush from 'web-push';

// Web-Push-Versand für den Minuten-Tick und den Test-Endpoint: VAPID-Konfiguration
// und ein Sender, der eine Nachricht an Abos verteilt und Abos, die der
// Push-Dienst endgültig ablehnt, aus push_subscriptions entfernt.

type Sb = SupabaseClient<Database>;

export type PushSubscriptionKeys = Pick<
  Database['public']['Tables']['push_subscriptions']['Row'],
  'endpoint' | 'p256dh' | 'auth'
>;

/** Payload-Form, die public/push-sw.js auswertet. Gleicher tag ersetzt die vorige Nachricht. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

// VAPID-Schlüsselpaar nur aus der Env (öffentlicher Teil nicht geheim, privater geheim).
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || '';

/** Setzt die VAPID-Daten für web-push. false = Schlüssel fehlen, es kann nichts verschickt werden. */
export function configureVapid(): boolean {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey || !VAPID_PUBLIC) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC, privateKey);
  return true;
}

/** Ergebnis eines Versands: hat mindestens ein Gerät angenommen, und welcher Fehler trat auf? */
export interface SendResult {
  anyDelivered: boolean;
  /** Erste Ablehnung außer 404/410 als lesbarer Text, auch wenn ein anderes Gerät angenommen hat; sonst null. */
  error: string | null;
}

function describeSendError(e: unknown): string {
  const { statusCode, body, message } = e as { statusCode?: number; body?: string; message?: string };
  if (statusCode) return `Push-Dienst antwortet ${statusCode}${body ? `: ${body.slice(0, 200)}` : ''}`;
  return message || String(e);
}

/** Sender über die übergebenen Abos; entfernt Endpoints, die der Push-Dienst als erloschen meldet. */
export function makeSender(sb: Sb, subs: PushSubscriptionKeys[]) {
  let live = subs;
  const state = { pushes: 0, pruned: 0 };

  async function send(payload: PushPayload): Promise<SendResult> {
    if (!live.length) return { anyDelivered: false, error: null };
    const dead: string[] = [];
    let delivered = 0;
    let error: string | null = null;
    await Promise.all(
      live.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
          );
          delivered++;
          state.pushes++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          // 404/410: Endpoint dauerhaft weg → Abo löschen. Jeder andere Fehler ist eine
          // Ablehnung, die erste davon landet in error; ob der Claim bleibt, entscheidet der Aufrufer.
          if (code === 404 || code === 410) dead.push(s.endpoint);
          else error ??= describeSendError(e);
        }
      }),
    );
    if (dead.length) {
      await sb.from('push_subscriptions').delete().in('endpoint', dead);
      live = live.filter((s) => !dead.includes(s.endpoint));
      state.pruned += dead.length;
    }
    return { anyDelivered: delivered > 0, error };
  }

  const hasSubscribers = () => live.length > 0;

  return { send, state, hasSubscribers };
}
