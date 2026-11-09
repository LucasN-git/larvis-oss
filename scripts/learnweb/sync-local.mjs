#!/usr/bin/env node
// Lokaler Learnweb-Sync gegen die echte Supabase-DB. Read-only gegenüber
// Learnweb (nur Login + GETs + die zwei erlaubten Lese-AJAX-Methoden); alle
// Writes gehen in die learnweb_*-Cache-Tabellen.
//
// Voraussetzung: `npm run build -w @larvis/shared` (dist muss aktuell sein) und
// eine .env.local mit SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LEARNWEB_USERNAME,
// LEARNWEB_PASSWORD.
//
// Beispiele:
//   node --env-file=.env.local scripts/learnweb/sync-local.mjs                # laufende Kurse
//   node --env-file=.env.local scripts/learnweb/sync-local.mjs --course 12345 # nur ein Kurs
//   node --env-file=.env.local scripts/learnweb/sync-local.mjs --full         # Hash-Skip aus

import { createClient } from '@supabase/supabase-js';
import { syncLearnweb } from '../../packages/shared/dist/learnweb/index.js';

const args = process.argv.slice(2);
const courseArg = args.indexOf('--course');
const courseId = courseArg >= 0 ? Number(args[courseArg + 1]) : undefined;
const skipUnchanged = !args.includes('--full');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (--env-file=.env.local?).');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

console.log(`Learnweb-Sync${courseId ? ` (Kurs ${courseId})` : ''}${skipUnchanged ? '' : ' [full]'} …\n`);
try {
  const report = await syncLearnweb(db, { courseId, skipUnchanged, log: (m) => console.log('  ' + m) });
  console.log('\n=== Report ===');
  console.log(JSON.stringify(report, null, 2));
  if (report.warnings.length) {
    console.log(`\n${report.warnings.length} Warnung(en) — siehe oben.`);
  }
} catch (e) {
  console.error('\nSync fehlgeschlagen:', e instanceof Error ? e.message : e);
  process.exit(1);
}
