// Laufzeit für den Eigenbetrieb: liefert die gebaute PWA aus dist/ aus und
// bedient die api/-Endpoints aus dist-api/ mit einer kleinen Request- und
// Response-Fassade (query, body, status, json, send, redirect).
//
// Zwei Handler (mcp, oauth-protected-resource) sprechen direkt mit den
// Node-Objekten, der Rest mit der Fassade aus api/_lib/types.ts.
// Deshalb wird das native Response-Objekt hier erweitert statt ersetzt.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const staticDir = process.env.LARVIS_STATIC_DIR || path.join(webRoot, 'dist');
const apiDir = process.env.LARVIS_API_DIR || path.join(webRoot, 'dist-api');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const MAX_BODY = 25 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
};

/** Endpoint-Pfad ("google/oauth-start") → Datei in dist-api/. */
async function routeTable(dir, prefix = '') {
  const table = new Map();
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return table;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of await routeTable(full, `${prefix}${entry.name}/`)) table.set(k, v);
    } else if (entry.name.endsWith('.mjs')) {
      table.set(`${prefix}${entry.name.slice(0, -4)}`, full);
    }
  }
  return table;
}

const routes = await routeTable(apiDir);
const handlerCache = new Map();

async function loadHandler(route) {
  if (handlerCache.has(route)) return handlerCache.get(route);
  const file = routes.get(route);
  if (!file) return null;
  const mod = await import(pathToFileURL(file).href);
  const fn = mod.default;
  if (typeof fn !== 'function') throw new Error(`Endpoint ${route} hat keinen Default-Export`);
  handlerCache.set(route, fn);
  return fn;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Nicht req.destroy(): der Socket wäre weg, bevor die 413 rausgeht.
        req.pause();
        reject(Object.assign(new Error('Body zu groß'), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Body vorab parsen (JSON, Formular, Text), damit Handler req.body direkt lesen. */
function parseBody(raw, contentType = '') {
  if (!raw.length) return undefined;
  const type = contentType.split(';')[0].trim();
  if (type === 'application/json') {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return undefined;
    }
  }
  if (type === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  }
  if (!type || type.startsWith('text/')) return raw.toString('utf8');
  return raw;
}

/** status/json/send/redirect auf das native ServerResponse legen. */
function decorate(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  res.send = (body) => {
    if (body === undefined || body === null) return res.end();
    if (typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body);
    if (!res.headersSent && !res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', Buffer.isBuffer(body) ? 'application/octet-stream' : 'text/html; charset=utf-8');
    }
    res.end(body);
  };
  // res.redirect(url) antwortet mit 307, res.redirect(code, url) mit dem Code.
  res.redirect = (arg1, arg2) => {
    const [code, url] = typeof arg1 === 'number' ? [arg1, arg2] : [307, arg1];
    res.statusCode = code;
    res.setHeader('Location', url);
    res.end();
  };
  return res;
}

function cacheHeader(pathname) {
  if (/\/assets\/.+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
  if (/\.(?:html|webmanifest)$/.test(pathname) || /\/(?:sw|registerSW|push-sw|workbox-[^/]+)\.js$/.test(pathname)) {
    return 'no-cache';
  }
  return 'public, max-age=3600';
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false; // kaputte Prozent-Kodierung: keine Datei, kein 500
  }
  const rel = decoded.replace(/^\/+/, '');
  const target = path.resolve(staticDir, rel);
  if (target !== staticDir && !target.startsWith(staticDir + path.sep)) return false;
  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', cacheHeader(pathname));
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  // pipeline räumt den Lesestream auch dann ab, wenn der Client mitten im
  // Download abbricht — mit einem eigenen Promise bliebe der fd offen.
  await pipeline(fs.createReadStream(target), res);
  return true;
}

async function serveIndex(res) {
  const index = path.join(staticDir, 'index.html');
  const html = await fsp.readFile(index);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME['.html']);
  res.setHeader('Cache-Control', 'no-cache');
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  try {
    if (pathname === '/healthz') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, routes: routes.size }));
      return;
    }

    // Die RFC-9728-Metadaten liegen am Domain-Root; der Server bedient die Route selbst.
    const route =
      pathname === '/.well-known/oauth-protected-resource'
        ? 'oauth-protected-resource'
        : pathname.startsWith('/api/')
          ? pathname.slice(5).replace(/\/+$/, '')
          : null;

    if (route !== null) {
      const handler = await loadHandler(route);
      if (!handler) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      // API-Antworten gehen nie in einen Zwischencache; der Handler darf den
      // Header überschreiben.
      res.setHeader('Cache-Control', 'no-store');
      // Ohne Obergrenze hielte ein halb offener SSE-Stream des MCP-Endpoints
      // dauerhaft einen Server plus Supabase-Client fest. 600s deckt auch den
      // langen Learnweb-Sync ab.
      res.setTimeout(600_000, () => res.end());
      const raw = await readBody(req);
      req.body = parseBody(raw, req.headers['content-type'] || '');
      req.query = Object.fromEntries(
        [...url.searchParams.keys()].map((k) => {
          const all = url.searchParams.getAll(k);
          return [k, all.length > 1 ? all : all[0]];
        }),
      );
      decorate(res);
      await handler(req, res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end('Method not allowed');
      return;
    }

    if (await serveStatic(req, res, pathname)) return;

    // Ein Pfad mit Dateiendung meint eine Datei, keine Client-Route. Sonst
    // bekäme ein Client, der nach einem Deploy einen alten Asset-Hash nachlädt,
    // HTML mit falschem MIME-Typ statt eines ehrlichen 404.
    if (/\.[a-z0-9]{1,8}$/i.test(pathname) && !pathname.endsWith('.html')) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }

    // SPA-Fallback für die Client-Routen (React Router).
    await serveIndex(res);
  } catch (e) {
    const code = e && e.code;
    if (code === 'ECONNRESET' || code === 'EPIPE' || req.destroyed) {
      // Client hat aufgelegt — kein Serverfehler, nur Rauschen im Log.
      return;
    }
    const status = e && e.statusCode ? e.statusCode : 500;
    // Client-Fehler brauchen keinen Stacktrace, nur eine Zeile.
    if (status >= 500) console.error(`[larvis] ${req.method} ${pathname}:`, e);
    else console.warn(`[larvis] ${req.method} ${pathname}: ${status} ${e.message}`);
    if (!res.headersSent) {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: status === 500 ? 'Internal error' : String(e.message || e) }));
    } else {
      res.end();
    }
  }
});

// Großzügige Zeitgrenzen (der Learnweb-Sync kann Minuten dauern), damit der
// Proxy und nicht Node die Obergrenze setzt.
server.requestTimeout = 600_000;
server.headersTimeout = 620_000;
server.keepAliveTimeout = 65_000;

server.listen(port, host, () => {
  console.log(`[larvis] listening on ${host}:${port} — ${routes.size} API-Endpoints, static: ${staticDir}`);
});

// Eine unbehandelte Rejection aus einem Handler darf den Server nicht mitnehmen.
process.on('unhandledRejection', (reason) => {
  console.error('[larvis] unhandledRejection:', reason);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
