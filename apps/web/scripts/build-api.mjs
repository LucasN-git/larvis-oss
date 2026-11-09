// Bündelt die api/-Handler für den Betrieb nach dist-api/.
//
// Jede Datei unter api/ (außer _lib/) ist ein Endpoint. esbuild kompiliert das
// TypeScript und löst die Imports auf: pro Endpoint eine selbstgenügsame .mjs,
// die server/index.mjs beim ersten Request lädt.
//
// Extern bleiben die Pakete, die auch die vorhandenen _lib-Bundles extern
// lassen — so teilen Function und Bundle eine SDK-/Supabase-Instanz. Sie liegen
// im Runtime-Image als schlanke package.json (siehe Dockerfile).
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const apiDir = path.join(webRoot, 'api');
const outDir = path.join(webRoot, 'dist-api');

/** Alle Endpoint-Quellen unter api/, ohne die Helfer in _lib/. */
async function collect(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '_lib') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(full)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const entryPoints = await collect(apiDir);
console.log(`[build-api] ${entryPoints.length} Endpoints → ${path.relative(webRoot, outDir)}`);

await build({
  entryPoints,
  outdir: outDir,
  outbase: apiDir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Sourcemaps sind dreimal so groß wie die Bundles und wandern sonst ins
  // Runtime-Image; für eine Fehlersuche mit LARVIS_SOURCEMAP=1 anfordern.
  sourcemap: process.env.LARVIS_SOURCEMAP === '1',
  logLevel: 'info',
  // Gleiche Grenze wie build-mcp-bundle.mjs, plus web-push (nutzt node:crypto
  // direkt und lässt sich nicht sinnvoll einbacken).
  external: [
    '@modelcontextprotocol/sdk',
    '@modelcontextprotocol/sdk/*',
    '@supabase/supabase-js',
    'web-push',
  ],
  // esbuild shimmt CJS-`require` in ESM-Ausgaben nur, wenn global eines
  // existiert (iconv-lite via cheerio stolpert sonst beim Laden).
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});

console.log('[build-api] fertig');
