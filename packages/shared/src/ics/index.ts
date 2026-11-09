// Öffentliche Oberfläche der Kalender-Abos (read-only ICS). Wird als Subpath
// `@larvis/shared/ics` exportiert und BEWUSST NICHT aus src/index.ts re-exportiert,
// damit ical.js und node:crypto nicht ins Vite-Browser-Bundle geraten. Nutzer: die
// Web-API (über das Bundle api/_lib/ics-bundle.js) und der MCP-Server.
export * from './fetch.js';
export * from './parse.js';
export * from './subscriptions.js';
export { resolveIanaZone, wallClockToUtc } from './timezones.js';
export { compareEventStart, isSubscriptionId, SUBSCRIPTION_ID_PREFIX } from '../calendar.js';
