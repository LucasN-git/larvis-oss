import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { calendarFixture, subscriptionFixture } from './dev/calendar-fixture.mjs';

// Dev-Login-Bypass (siehe src/lib/devBypass.ts): liefert eine lokal abgelegte Sitzung und
// Kalender-Testdaten (dev/calendar-fixture.mjs)
// an die App aus. Nur im Dev-Server (`apply: 'serve'`) und nur mit VITE_DEV_BYPASS_AUTH=1
// registriert, nie im Build.
function devSessionEndpoint(): Plugin {
  return {
    name: 'larvis-dev-session',
    apply: 'serve',
    configureServer(server) {
      // Nur Loopback: der Dev-Server lauscht im LAN (server.host), die Tokens gehören aber
      // ausschließlich dem eigenen Rechner.
      const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
      // Kalender-Abos: in-memory, ohne den Link abzurufen; reicht für Oberflächen-Checks.
      const subs: Array<Record<string, unknown> & { id: string }> = subscriptionFixture.map(
        (s: Record<string, unknown> & { id: string }) => ({ ...s }),
      );
      // Kalender-Testdaten: /api/calendar/events liegt in Produktion hinter der Google-API.
      // Abo-Termine folgen dem Stand der Abo-Liste oben (Name, Farbe, Projekt, Schalter),
      // damit Änderungen in der Abo-Verwaltung sofort im Kalender sichtbar sind.
      server.middlewares.use('/api/calendar/events', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 501;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Dev-Kalender ist nur lesbar.' }));
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        const byCalId = new Map(subs.map((s) => [`sub:${s.id}`, s]));
        const events = calendarFixture().flatMap((ev: Record<string, unknown>) => {
          if (ev.calendar !== 'subscription') return [ev];
          const sub = byCalId.get(String(ev.calendar_id));
          if (!sub || !sub.enabled) return [];
          return [{ ...ev, calendar_name: sub.name, color: sub.color, project_id: sub.project_id ?? null }];
        });
        const enabled = subs.filter((s) => s.enabled).length;
        res.end(JSON.stringify({ connected: true, subscriptions: enabled, events }));
      });
      server.middlewares.use('/api/calendar/subscriptions', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.end(JSON.stringify(body));
        };
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          const id = new URL(req.url ?? '', 'http://dev').searchParams.get('id') ?? String(body.id ?? '');
          if (req.method === 'GET') return send(200, { subscriptions: subs });
          // Wie die echte API: project_id ist eine uuid oder null (ob das Projekt existiert,
          // prüft erst der Server gegen die Datenbank).
          const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if ('project_id' in body && body.project_id !== null && body.project_id !== '' && !uuid.test(String(body.project_id))) {
            return send(422, { error: 'Das Projekt gibt es nicht.' });
          }
          if ('name' in body && req.method === 'PATCH' && !String(body.name ?? '').trim()) {
            return send(422, { error: 'Der Name darf nicht leer sein.' });
          }
          if (req.method === 'POST') {
            const url = String(body.url ?? '');
            if (!/^(https?|webcal):\/\//i.test(url)) return send(422, { error: 'Das ist kein gültiger Link.' });
            const sub = {
              id: crypto.randomUUID(),
              name: String(body.name || new URL(url.replace(/^webcal/i, 'https')).hostname),
              color: String(body.color || '#2f6fed'),
              project_id: body.project_id || null,
              enabled: true,
              url_hint: `${new URL(url.replace(/^webcal/i, 'https')).host}/…`,
              last_synced_at: new Date().toISOString(),
              last_error: null,
              created_at: new Date().toISOString(),
            };
            subs.push(sub);
            return send(200, { subscription: sub });
          }
          const idx = subs.findIndex((s) => s.id === id);
          if (idx < 0) return send(422, { error: 'Abo nicht gefunden.' });
          if (req.method === 'PATCH') {
            const next = { ...subs[idx], ...(body as object), id };
            if ('name' in body) next.name = String(body.name).trim().slice(0, 80);
            if ('project_id' in body) next.project_id = body.project_id || null;
            subs[idx] = next;
            return send(200, { subscription: subs[idx] });
          }
          if (req.method === 'DELETE') {
            subs.splice(idx, 1);
            return send(200, { deleted: id });
          }
          send(405, { error: 'Method not allowed.' });
        });
      });
      server.middlewares.use('/__dev/session', async (req, res) => {
        if (!loopback.has(req.socket.remoteAddress ?? '')) {
          res.statusCode = 404;
          res.end();
          return;
        }
        try {
          const raw = await readFile(join(homedir(), '.config', 'larvis', 'dev-session.json'), 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(raw);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

// `@larvis/shared` resolves to its TypeScript source so the web app needs no
// pre-build step in dev (Vite resolves the `.js` import specifiers to `.ts`).
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    loadEnv(mode, process.cwd(), '').VITE_DEV_BYPASS_AUTH === '1' && devSessionEndpoint(),
    VitePWA({
      // Ship updates silently: a new deploy swaps the service worker on next launch,
      // so the home-screen app never gets stuck on a stale build.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'robots.txt'],
      manifest: {
        id: '/',
        name: 'Larvis',
        short_name: 'Larvis',
        description: 'Dein persönliches Life-OS — ToDos, Notizen, Projekte, Kalender.',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#FAFAFB',
        theme_color: '#FAFAFB',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // SPA fallback for client-side routes, but never hijack server paths. Supabase runs on
        // the same origin (Caddy routes /auth/v1, /rest/v1, … by prefix); without these entries
        // the OAuth authorize link of an MCP client opens the app instead of the auth server.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/auth\//,
          /^\/rest\//,
          /^\/storage\//,
          /^\/realtime\//,
          /^\/\.well-known\//,
        ],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Pull our push + notificationclick handlers into the generated SW so
        // home-screen push works without switching to the injectManifest strategy.
        importScripts: ['push-sw.js'],
      },
      devOptions: {
        // Keep the service worker off during `vite dev`; test it via `vite preview`.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@larvis/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true, // expose on LAN so other devices (phone, kiosk screen) can reach the dev server
  },
}));
