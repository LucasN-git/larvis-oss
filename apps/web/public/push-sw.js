/* Push-Handler für Larvis. Wird via `workbox.importScripts` oben in den
 * generierten Service Worker eingebunden (vite-plugin-pwa, generateSW-Modus).
 * Der Rest des SW (Precache, Routing) kommt weiterhin von Workbox.
 *
 * Payload-Form vom Server (api/notifications/tick und api/notifications/test):
 *   { title, body, url, tag }
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Larvis';
  const options = {
    body: data.body || '',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    // Gleicher tag = eine Erinnerung ersetzt die vorige statt sich zu stapeln.
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Ein bereits offenes Larvis-Fenster fokussieren, sonst neu öffnen.
      for (const win of wins) {
        if (win.url.indexOf(self.location.origin) === 0 && 'focus' in win) {
          win.focus();
          if ('navigate' in win && targetUrl !== '/') win.navigate(targetUrl).catch(() => {});
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    }),
  );
});
