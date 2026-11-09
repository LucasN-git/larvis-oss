#!/usr/bin/env node
// Zieht eine Learnweb-Seite (eingeloggt, read-only) und speichert das rohe HTML
// als Test-Fixture. Fixtures liegen gitignored unter
// packages/shared/test/fixtures/learnweb/ und speisen die Parser-Tests.
//
// Voraussetzung: gebautes @larvis/shared-dist + .env.local mit
// LEARNWEB_USERNAME/LEARNWEB_PASSWORD.
//
// Beispiel:
//   node --env-file=.env.local scripts/learnweb/fetch-fixture.mjs \
//        'course/view.php?id=12345' packages/shared/test/fixtures/learnweb/course.html

import { writeFileSync } from 'node:fs';
import { login, lwGet } from '../../packages/shared/dist/learnweb/index.js';

const [path, out] = process.argv.slice(2);
if (!path || !out) {
  console.error('Aufruf: fetch-fixture.mjs <learnweb-pfad> <ausgabedatei>');
  process.exit(1);
}

const session = await login();
const html = await lwGet(session, path);
writeFileSync(out, html);
console.log(`${html.length} Bytes -> ${out}`);
