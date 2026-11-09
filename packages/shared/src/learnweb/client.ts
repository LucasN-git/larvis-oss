// Learnweb-HTTP-Client (Moodle Uni Münster) — READ-ONLY BY CONSTRUCTION.
//
// Dies ist das einzige Modul, das je eine Verbindung zu sso.uni-muenster.de
// öffnet. Es exportiert genau vier netzwerknahe Funktionen:
//   - login()        POSTet EINMAL das SSO-Anmeldeformular (der einzige
//                    schreibende Request überhaupt: er erzeugt nur eine Session).
//   - lwGet()        GET einer Learnweb-Seite (Session-Cookie).
//   - lwAjax()       POST an Moodles interne AJAX-API, aber NUR mit einer der
//                    beiden hartcodierten Lese-Methoden aus AJAX_ALLOWLIST.
//   - cookieHeader() Cookie-String für externe Streaming-Downloads (ffmpeg).
//
// Es gibt bewusst KEINEN generischen POST/PUT/DELETE-Helper. Kein Moodle-Formular
// wird je abgeschickt, kein sesskey für Aktionen verwendet. Credentials werden an
// genau einer Stelle (login()) aus process.env gelesen und nie in Logs, Fehler,
// Reports oder die DB geschrieben.

export const LEARNWEB_BASE = 'https://sso.uni-muenster.de/LearnWeb/learnweb2';

// Die EINZIGEN zwei RPC-Methoden, die je gePOSTet werden dürfen. Beide sind
// reine Leseabfragen (Kursliste, anstehende Termine). Änderungen an dieser Liste
// sind sicherheitsrelevant.
export const AJAX_ALLOWLIST = [
  'core_course_get_enrolled_courses_by_timeline_classification',
  'core_calendar_get_action_events_by_timesort',
] as const;
export type LwAjaxMethod = (typeof AJAX_ALLOWLIST)[number];

export interface LearnwebSession {
  /** Cookie-Jar (name -> value), nur im RAM, pro Login frisch. */
  jar: Map<string, string>;
  /** Moodle-sesskey der Session (aus dem Seiten-HTML), nur für Lese-AJAX. */
  sesskey: string;
}

/** Anmeldung abgelehnt oder Session abgelaufen. */
export class LearnwebAuthError extends Error {
  constructor(message = 'Learnweb-Authentifizierung fehlgeschlagen.') {
    super(message);
    this.name = 'LearnwebAuthError';
  }
}
/** Learnweb ist im Wartungsmodus. */
export class LearnwebMaintenanceError extends Error {
  constructor(message = 'Learnweb ist im Wartungsmodus.') {
    super(message);
    this.name = 'LearnwebMaintenanceError';
  }
}
/** HTML/JSON ließ sich nicht wie erwartet parsen (Markup geändert?). */
export class LearnwebParseError extends Error {
  constructor(message = 'Learnweb-Antwort konnte nicht geparst werden.') {
    super(message);
    this.name = 'LearnwebParseError';
  }
}

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 Larvis-Learnweb/1.0';

function serializeCookies(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Cookie-String für externe Downloads (z. B. ffmpeg -headers). */
export function cookieHeader(session: LearnwebSession): string {
  return serializeCookies(session.jar);
}

/** Set-Cookie-Header in den Jar mergen (nur name=value, Attribute ignoriert). */
function mergeSetCookies(jar: Map<string, string>, res: Response): void {
  // getSetCookie() ist ab Node 20 / undici verfügbar und trennt mehrere
  // Set-Cookie-Header korrekt (anders als headers.get('set-cookie')).
  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getSetCookie === 'function' ? getSetCookie.call(res.headers) : [];
  for (const raw of cookies) {
    const first = raw.split(';', 1)[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  }
}

interface RequestResult {
  finalUrl: string;
  status: number;
  html: string;
}

/**
 * Ein Request mit manuellem Redirect-Handling und Cookie-Jar. Folgt bis zu 10
 * Hops selbst (nötig, weil der SSO-Proxy über mehrere Redirects Cookies setzt).
 * `init.body`/`init.method` bleiben nur für den ersten Hop; Redirects werden als
 * GET verfolgt (Standardverhalten für 302 nach POST).
 */
async function request(
  jar: Map<string, string>,
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<RequestResult> {
  let currentUrl = url;
  let method = init.method ?? 'GET';
  let body: string | undefined = init.body;
  let headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...init.headers };

  for (let hop = 0; hop < 10; hop++) {
    const cookie = serializeCookies(jar);
    const res: Response = await fetch(currentUrl, {
      method,
      body,
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    mergeSetCookies(jar, res);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { finalUrl: currentUrl, status: res.status, html: await res.text() };
      currentUrl = new URL(location, currentUrl).toString();
      // Nach dem ersten Redirect ist es immer ein GET ohne Body.
      method = 'GET';
      body = undefined;
      headers = { 'User-Agent': USER_AGENT };
      continue;
    }
    return { finalUrl: currentUrl, status: res.status, html: await res.text() };
  }
  throw new LearnwebParseError('Zu viele Redirects beim Learnweb-Request.');
}

/** Erkennt die SSO-Anmeldeseite (Titel „Anmeldung - Login" bzw. das Login-Formularfeld). */
export function isLoginPage(html: string): boolean {
  return html.includes('Anmeldung - Login') || html.includes('name="httpd_username"');
}

/** Zieht den Moodle-sesskey aus dem Seiten-HTML (M.cfg / Formulare). */
export function extractSesskey(html: string): string | null {
  const m = html.match(/"sesskey":"([^"]+)"/) || html.match(/name="sesskey" value="([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * Erkennt eine Wartungs-/Offline-Meldung und gibt den Meldungstext zurück
 * (sonst null). Deckt Moodles Wartungsseite und das tool_opencast-Banner ab.
 */
export function extractMaintenanceNotice(html: string): string | null {
  if (/Diese Website wird gerade gewartet|is currently undergoing maintenance/i.test(html)) {
    return 'Learnweb wird gerade gewartet.';
  }
  const m = html.match(/tool_opencast\/maintenance'\);[\s\S]{0,120}?amd\.notification\("([^"]+)"/);
  if (m) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\\u00fc/g, 'ü').trim();
    if (text) return text;
  }
  return null;
}

/**
 * Meldet sich am SSO an und liefert Session (Cookie-Jar + sesskey). Der einzige
 * Ort, an dem LEARNWEB_USERNAME/LEARNWEB_PASSWORD gelesen werden. Die
 * Credentials werden mit URLSearchParams kodiert und tauchen in keinem Log,
 * keiner Fehlermeldung und keinem Rückgabewert auf.
 */
export async function login(): Promise<LearnwebSession> {
  const username = process.env.LEARNWEB_USERNAME;
  const password = process.env.LEARNWEB_PASSWORD;
  if (!username || !password) {
    throw new LearnwebAuthError('LEARNWEB_USERNAME/LEARNWEB_PASSWORD sind nicht gesetzt.');
  }

  const jar = new Map<string, string>();
  const body = new URLSearchParams({
    httpd_username: username,
    httpd_password: password,
    httpd_dummy: String(Date.now()),
  }).toString();

  const { html } = await request(jar, `${LEARNWEB_BASE}/my/`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (isLoginPage(html)) {
    throw new LearnwebAuthError('Learnweb-Login fehlgeschlagen — das SSO hat die Anmeldung abgelehnt.');
  }
  const maintenance = extractMaintenanceNotice(html);
  if (maintenance && isMaintenancePage(html)) throw new LearnwebMaintenanceError(maintenance);

  const sesskey = extractSesskey(html);
  if (!sesskey) {
    throw new LearnwebParseError('sesskey nach dem Login nicht gefunden (Markup geändert?).');
  }
  return { jar, sesskey };
}

/** Volle Wartungsseite (nicht nur ein informatives Banner auf einer sonst nutzbaren Seite). */
function isMaintenancePage(html: string): boolean {
  return /Diese Website wird gerade gewartet|is currently undergoing maintenance/i.test(html);
}

/**
 * GET einer Learnweb-Seite (Pfad relativ zu LEARNWEB_BASE, z. B.
 * 'course/view.php?id=12345'). Wirft bei abgelaufener Session bzw. Wartung.
 * Fehlermeldungen enthalten nur Pfad + Status, nie Body-Inhalte.
 */
export async function lwGet(session: LearnwebSession, path: string): Promise<string> {
  const url = path.startsWith('http') ? path : `${LEARNWEB_BASE}/${path.replace(/^\//, '')}`;
  const { html, status } = await request(session.jar, url);
  if (isLoginPage(html)) throw new LearnwebAuthError('Learnweb-Session abgelaufen.');
  if (isMaintenancePage(html)) {
    throw new LearnwebMaintenanceError(extractMaintenanceNotice(html) ?? 'Learnweb wird gerade gewartet.');
  }
  if (status < 200 || status >= 300) {
    throw new LearnwebParseError(`Learnweb HTTP ${status} für ${path}`);
  }
  return html;
}

/**
 * Ruft eine der beiden erlaubten Lese-Methoden von Moodles interner AJAX-API auf.
 * Doppelt abgesichert: TypeScript-Union-Typ + Runtime-Allowlist-Check.
 */
export async function lwAjax<T = unknown>(
  session: LearnwebSession,
  method: LwAjaxMethod,
  args: Record<string, unknown>,
): Promise<T> {
  if (!AJAX_ALLOWLIST.includes(method)) {
    throw new Error('lwAjax: Methode nicht in der Read-Only-Allowlist.');
  }
  const url = `${LEARNWEB_BASE}/lib/ajax/service.php?sesskey=${encodeURIComponent(session.sesskey)}&info=${method}`;
  const { html, status } = await request(session.jar, url, {
    method: 'POST',
    body: JSON.stringify([{ index: 0, methodname: method, args }]),
    headers: { 'Content-Type': 'application/json' },
  });
  if (isLoginPage(html)) throw new LearnwebAuthError('Learnweb-Session abgelaufen.');
  if (status < 200 || status >= 300) throw new LearnwebParseError(`AJAX ${method}: HTTP ${status}`);

  let parsed: Array<{ error?: boolean; data?: T; exception?: { errorcode?: string } }>;
  try {
    parsed = JSON.parse(html);
  } catch {
    throw new LearnwebParseError(`AJAX ${method}: Antwort war kein JSON.`);
  }
  const item = parsed[0];
  if (!item) throw new LearnwebParseError(`AJAX ${method}: leere Antwort.`);
  if (item.error) {
    const code = item.exception?.errorcode ?? 'unknown';
    if (code === 'servicerequireslogin' || code === 'invalidsesskey') {
      throw new LearnwebAuthError('Learnweb-Session abgelaufen.');
    }
    throw new LearnwebParseError(`AJAX ${method}: ${code}`);
  }
  return item.data as T;
}
