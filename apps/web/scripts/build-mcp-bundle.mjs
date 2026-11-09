// Produces api/_lib/mcp-bundle.js: the whole Larvis MCP server flattened into one
// self-contained file the API handler api/mcp.ts can import relatively.
//
// Why: the API handlers are bundled from apps/web, so a workspace package
// can't be resolved as a *value* import at runtime (only types, which are erased)
// — see the note in api/_lib/calendar.ts. Rather than hand-copy the tools, we
// build @larvis/mcp-server to dist and esbuild-bundle it here, inlining the
// workspace code (@larvis/shared + mcp-server) while keeping the npm deps
// external so the function and the bundle share one SDK/supabase instance.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..'); // apps/web
const repoRoot = path.resolve(webRoot, '../..'); // repo root

// esbuild-ESM-Bundles shimmen CJS-`require` nur, wenn global ein `require`
// existiert — sonst wirft z. B. iconv-lite (via cheerio) beim Laden
// "Dynamic require of 'buffer' is not supported". createRequire stellt es bereit.
const cjsInteropBanner = {
  js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
};

console.log('[mcp-bundle] building @larvis/shared + @larvis/mcp-server…');
execSync('npm run build:mcp', { cwd: repoRoot, stdio: 'inherit' });

const outfile = path.join(webRoot, 'api/_lib/mcp-bundle.js');
console.log('[mcp-bundle] bundling →', path.relative(repoRoot, outfile));
await build({
  entryPoints: [path.join(repoRoot, 'packages/mcp-server/dist/server.js')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*', '@supabase/supabase-js'],
  banner: cjsInteropBanner,
  logLevel: 'info',
});
console.log('[mcp-bundle] done');

// Learnweb-Sync-Bundle für den Handler api/learnweb/sync.ts. Gleiche
// Begründung wie oben: der Workspace-Code (@larvis/shared/learnweb inkl. cheerio)
// wird inlined, nur @supabase/supabase-js bleibt extern (der DB-Client wird
// übergeben). cheerio wird mit eingebacken.
const learnwebOut = path.join(webRoot, 'api/_lib/learnweb-bundle.js');
console.log('[learnweb-bundle] bundling →', path.relative(repoRoot, learnwebOut));
await build({
  entryPoints: [path.join(repoRoot, 'packages/shared/dist/learnweb/index.js')],
  outfile: learnwebOut,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@supabase/supabase-js'],
  banner: cjsInteropBanner,
  logLevel: 'info',
});
console.log('[learnweb-bundle] done');

// Kalender-Abo-Bundle (read-only ICS) für api/calendar/events.ts und
// api/calendar/subscriptions.ts. Gleiche Begründung wie oben: @larvis/shared/ics samt
// ical.js wird eingebacken, nur @supabase/supabase-js bleibt extern.
const icsOut = path.join(webRoot, 'api/_lib/ics-bundle.js');
console.log('[ics-bundle] bundling →', path.relative(repoRoot, icsOut));
await build({
  entryPoints: [path.join(repoRoot, 'packages/shared/dist/ics/index.js')],
  outfile: icsOut,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@supabase/supabase-js'],
  banner: cjsInteropBanner,
  logLevel: 'info',
});
console.log('[ics-bundle] done');
