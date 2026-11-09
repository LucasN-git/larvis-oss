// Web-Push-Anbindung im Browser: Zustimmung anfragen, beim Push-Dienst
// abonnieren und das Abo in `push_subscriptions` speichern (eine Zeile je
// Gerät). Der Minuten-Cron (api/notifications/tick) liest diese Zeilen und
// verschickt die Pushes.
import { isStandalone } from './pwa';
import { supabase } from './supabase';

// Öffentlicher VAPID-Schlüssel — bewusst im Client (nur der private Teil ist
// geheim, der lebt in der Server-Env). Kommt aus VITE_VAPID_PUBLIC_KEY; ohne ihn
// lassen sich keine Push-Abos anlegen (Schlüsselpaar: npx web-push generate-vapid-keys).
const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

/** Meldung, wenn kein Service Worker läuft — im Vite-Dev-Server ist er bewusst aus. */
export const SERVICE_WORKER_INACTIVE =
  'Service Worker nicht aktiv — Push geht nur in der gebauten bzw. installierten App.';

export type PushPermission = NotificationPermission | 'unsupported';

/**
 * Push-Zustand dieses Geräts:
 *   needs-install  iOS im Browser-Tab: Push gibt es erst in der Home-Bildschirm-App
 *   unsupported    der Browser kann kein Web Push
 *   inactive       kein aktiver Service Worker (Dev-Server)
 *   denied         Zustimmung verweigert
 *   off            möglich, aber kein Abo
 *   active         Abo vorhanden
 */
export type PushStatus = 'needs-install' | 'unsupported' | 'inactive' | 'denied' | 'off' | 'active';

/** True when this browser can do Web Push at all (SW + PushManager + Notification). */
export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iPhone, iPad oder iPod. iPadOS gibt sich als Mac aus, verrät sich aber über Touch. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** iOS erlaubt Web Push nur der installierten Home-Bildschirm-App, nicht dem Safari-Tab. */
export function pushNeedsInstall(): boolean {
  return isIOS() && !isStandalone();
}

/** Der Teil des Zustands, der ohne Service Worker feststeht; null = erst prüfen. */
export function immediatePushStatus(): PushStatus | null {
  if (pushNeedsInstall()) return 'needs-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return null;
}

/** Vollständiger Zustand dieses Geräts samt Endpoint des Abos. */
export async function getPushStatus(): Promise<{ status: PushStatus; endpoint: string | null }> {
  const immediate = immediatePushStatus();
  if (immediate) return { status: immediate, endpoint: null };
  let reg: ServiceWorkerRegistration;
  try {
    reg = await activeRegistration();
  } catch {
    return { status: 'inactive', endpoint: null };
  }
  const sub = Notification.permission === 'granted' ? await reg.pushManager.getSubscription() : null;
  return sub ? { status: 'active', endpoint: sub.endpoint } : { status: 'off', endpoint: null };
}

/**
 * Registrierung mit aktivem Service Worker. navigator.serviceWorker.ready löst
 * ohne Worker nie auf (im Dev-Server ist er aus), deshalb mit Zeitlimit: ohne
 * jede Registrierung nur kurz, während einer laufenden Installation länger.
 */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const registered = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(SERVICE_WORKER_INACTIVE)), registered ? 10_000 : 1_500);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Endpoint des Push-Abos dieses Geräts, null ohne Abo. Wirft, wenn kein Service Worker läuft. */
export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  const reg = await activeRegistration();
  return (await reg.pushManager.getSubscription())?.endpoint ?? null;
}

/** VAPID key (base64url) -> Uint8Array for `applicationServerKey`. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Wurde das Abo mit dem aktuellen VAPID-Key abgeschlossen? Verrät der Browser den Key nicht, gilt es als aktuell. */
function hasCurrentKey(sub: PushSubscription): boolean {
  const key = sub.options?.applicationServerKey;
  if (!key) return true;
  const stored = new Uint8Array(key);
  const current = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  return stored.length === current.length && stored.every((byte, i) => byte === current[i]);
}

function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    // Cast: the DOM lib types applicationServerKey as BufferSource<ArrayBuffer>,
    // but a Uint8Array is a valid server key at runtime.
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });
}

/** Persist (or refresh) a subscription row, keyed by its endpoint. */
async function storeSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const keys = json.keys ?? {};
  if (!json.endpoint || !keys.p256dh || !keys.auth) throw new Error('Ungültige Push-Subscription.');
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: json.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: navigator.userAgent,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw new Error(error.message);
}

/**
 * Stellt das Abo dieses Geräts sicher und speichert es. Ein Abo mit altem
 * VAPID-Key kann der Server nicht beliefern: abmelden, neu abonnieren, die alte
 * Zeile löschen (auch wenn das neue Abo scheitert, sonst bliebe eine tote Zeile
 * stehen) und die neue speichern.
 */
async function ensureSubscription(reg: ServiceWorkerRegistration): Promise<void> {
  let sub = await reg.pushManager.getSubscription();
  if (sub && !hasCurrentKey(sub)) {
    const stale = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    try {
      sub = await subscribe(reg);
    } finally {
      await supabase.from('push_subscriptions').delete().eq('endpoint', stale);
    }
  }
  await storeSubscription(sub ?? (await subscribe(reg)));
}

/**
 * Zustimmung anfragen, abonnieren und speichern. Muss direkt aus einem Klick
 * heraus laufen: requestPermission ist deshalb der erste Aufruf, vor jedem await.
 * Liefert den Zustimmungs-Stand, damit die UI eine Ablehnung zeigen kann.
 */
export async function enablePush(): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  await ensureSubscription(await activeRegistration());
  return 'granted';
}

/** Meldet dieses Gerät beim Push-Dienst ab und löscht seine Zeile. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await activeRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw new Error(error.message);
}

/**
 * Beim App-Start nach dem Login: Hat das Gerät zugestimmt und ein Abo, wird es
 * gespeichert (Endpoints rotieren, iOS verwirft sie bei Neuinstallation) und bei
 * altem VAPID-Key erneuert. Legt ohne vorhandenes Abo keins an. Wirft nie.
 */
export async function syncSubscription(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await activeRegistration();
    if (!(await reg.pushManager.getSubscription())) return;
    await ensureSubscription(reg);
  } catch {
    /* best effort */
  }
}
