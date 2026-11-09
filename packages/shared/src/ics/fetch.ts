// Abruf eines ICS-Links: Link prüfen und normalisieren, mit Zeitlimit und
// Größengrenze laden. Der Link ist ein Geheimnis (wer ihn kennt, liest den Kalender)
// und taucht deshalb in keiner Fehlermeldung auf.
import { IcsError } from './parse.js';

/** Zeitlimit je Abruf. Outlook antwortet gelegentlich langsam, länger blockiert es die Kalenderansicht. */
const FETCH_TIMEOUT_MS = 12_000;
/** Obergrenze der Antwort. Ein Outlook-Kalender mit Jahren an Verlauf liegt bei wenigen MB. */
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/**
 * Hosts, die ein Abo nie ansprechen darf: der Server würde sonst Dienste im eigenen Netz
 * abrufen (Supabase-Container, Metadaten-Endpunkte). Für lokale Tests schaltet
 * LARVIS_ICS_ALLOW_PRIVATE=1 die Sperre ab. Geprüft wird nur der Hostname: ein DNS-Name,
 * der auf eine interne IP zeigt, kommt durch (Link gibt nur der Besitzer ein, die Antwort
 * sieht er nur als Kalender).
 */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h.includes('.') && !h.includes(':')) return true; // localhost, Docker-Dienstnamen
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (h.includes(':')) {
    return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  }
  return false;
}

/**
 * Eingegebenen Link prüfen und in die abrufbare Form bringen: `webcal://` wird zu
 * `https://`, nur http(s) ist erlaubt. Wirft IcsError mit einer Meldung für die Oberfläche.
 */
export function normalizeIcsUrl(raw: string): string {
  const input = (raw ?? '').trim();
  if (!input) throw new IcsError('Bitte einen ICS-Link angeben.');
  const withScheme = input.replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new IcsError('Das ist kein gültiger Link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new IcsError('Nur Links mit https://, http:// oder webcal:// sind möglich.');
  }
  if (url.username || url.password) throw new IcsError('Links mit Zugangsdaten im Host sind nicht möglich.');
  if (process.env.LARVIS_ICS_ALLOW_PRIVATE !== '1' && isPrivateHost(url.hostname)) {
    throw new IcsError('Der Link zeigt auf eine interne Adresse.');
  }
  return url.toString();
}

/**
 * Anzeigefassung eines geheimen Links: Host plus maskiertes Ende, z. B.
 * "outlook.office365.com/…/calendar.ics". Lässt nichts Geheimes durch.
 */
export function maskIcsUrl(raw: string): string {
  try {
    const url = new URL(raw.replace(/^webcals?:\/\//i, 'https://'));
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments.at(-1) ?? '';
    const tail = last.length > 16 || /\d{6,}|[0-9a-f]{12,}/i.test(last) ? `…${last.slice(-4)}` : last;
    return tail ? `${url.host}/…/${tail}` : url.host;
  } catch {
    return '…';
  }
}

/** ICS-Text laden. Wirft IcsError mit einer Meldung für die Oberfläche (ohne den Link). */
export async function fetchIcs(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // Weiterleitungen von Hand folgen, damit auch deren Ziel die Host-Prüfung durchläuft.
    let res: Response | null = null;
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        res = await fetch(target, {
          signal: ctrl.signal,
          redirect: 'manual',
          headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'User-Agent': 'Larvis-Kalender/1.0' },
        });
      } catch (e) {
        if (ctrl.signal.aborted) throw new IcsError('Der Kalender hat nicht rechtzeitig geantwortet.');
        throw new IcsError(`Der Kalender ist nicht erreichbar (${e instanceof Error ? e.message : String(e)}).`);
      }
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      if (hop === MAX_REDIRECTS) throw new IcsError('Der Link leitet zu oft weiter.');
      await res.body?.cancel().catch(() => {});
      target = normalizeIcsUrl(new URL(location, target).toString());
    }
    if (!res) throw new IcsError('Der Kalender ist nicht erreichbar.');
    if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) {
      throw new IcsError(`Der Link gilt nicht (mehr) — vermutlich zurückgezogen oder falsch kopiert (HTTP ${res.status}).`);
    }
    if (!res.ok) throw new IcsError(`Der Kalenderdienst meldet einen Fehler (HTTP ${res.status}).`);

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new IcsError('Der Kalender ist zu groß (über 15 MB).');
    if (!res.body) return await res.text();

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new IcsError('Der Kalender ist zu groß (über 15 MB).');
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  } catch (e) {
    if (e instanceof IcsError) throw e;
    if (ctrl.signal.aborted) throw new IcsError('Der Kalender hat nicht rechtzeitig geantwortet.');
    throw new IcsError(`Der Kalender ließ sich nicht laden (${e instanceof Error ? e.message : String(e)}).`);
  } finally {
    clearTimeout(timer);
  }
}
