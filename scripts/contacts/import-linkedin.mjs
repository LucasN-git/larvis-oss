#!/usr/bin/env node
// LinkedIn-Import: liest Connections.csv aus dem LinkedIn-Datenexport und legt
// die Verbindungen als Kontakte an (source='linkedin').
//
// Dedup-Anker ist die Profil-URL: existiert ein Kontakt mit derselben
// linkedin_url, werden nur Firma/Position/Name aktualisiert (Geburtstag,
// Notizen, Tags etc. bleiben unangetastet) — der Import ist beliebig oft
// wiederholbar, z. B. nach einem frischen Export.
//
// Aufruf: node --env-file=.env.local scripts/contacts/import-linkedin.mjs [Pfad] [--dry-run]
//   Pfad default: material/linkedindata/Connections.csv
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (root-.env.local).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const csvPath = args.find((a) => !a.startsWith('--')) ?? 'material/linkedindata/Connections.csv';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (root-.env.local, via --env-file laden).');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Minimaler quote-fähiger CSV-Parser (Positionen enthalten Kommas und Quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = readFileSync(csvPath, 'utf8');
const allRows = parseCsv(raw);
// LinkedIn stellt dem Export einen "Notes:"-Vorspann voran — Header suchen.
const headerIdx = allRows.findIndex((r) => r[0] === 'First Name' && r[1] === 'Last Name');
if (headerIdx === -1) {
  console.error(`Kein "First Name,Last Name,…"-Header in ${csvPath} gefunden.`);
  process.exit(1);
}
const header = allRows[headerIdx];
const col = (name) => header.indexOf(name);
const [iFirst, iLast, iUrl, iEmail, iCompany, iPosition] =
  ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position'].map(col);

const normalizeUrl = (u) => u.trim().replace(/\/+$/, '');

const connections = allRows
  .slice(headerIdx + 1)
  .filter((r) => r.length >= header.length && (r[iFirst]?.trim() || r[iLast]?.trim()))
  .map((r) => ({
    first_name: r[iFirst].trim(),
    last_name: r[iLast].trim(),
    linkedin_url: normalizeUrl(r[iUrl] ?? '') || null,
    email: (r[iEmail] ?? '').trim(),
    company: (r[iCompany] ?? '').trim() || null,
    position: (r[iPosition] ?? '').trim() || null,
  }));

console.log(`${connections.length} Verbindungen in ${csvPath}`);

const { data: existing, error: exErr } = await db
  .from('contacts')
  .select('id,first_name,last_name,company,position,linkedin_url')
  .not('linkedin_url', 'is', null);
if (exErr) throw new Error(exErr.message);
const byUrl = new Map(existing.map((c) => [c.linkedin_url, c]));

let inserted = 0;
let updated = 0;
let unchanged = 0;

const toInsert = [];
for (const c of connections) {
  const found = c.linkedin_url ? byUrl.get(c.linkedin_url) : null;
  if (!found) {
    toInsert.push({
      first_name: c.first_name,
      last_name: c.last_name,
      linkedin_url: c.linkedin_url,
      emails: c.email ? [{ label: 'linkedin', value: c.email }] : [],
      company: c.company,
      position: c.position,
      source: 'linkedin',
      business: true,
    });
    continue;
  }
  const patch = {};
  if (c.first_name && c.first_name !== found.first_name) patch.first_name = c.first_name;
  if (c.last_name && c.last_name !== found.last_name) patch.last_name = c.last_name;
  if (c.company && c.company !== found.company) patch.company = c.company;
  if (c.position && c.position !== found.position) patch.position = c.position;
  if (Object.keys(patch).length === 0) { unchanged++; continue; }
  updated++;
  if (dryRun) { console.log(`~ ${c.first_name} ${c.last_name}: ${Object.keys(patch).join(', ')}`); continue; }
  const { error } = await db.from('contacts').update(patch).eq('id', found.id);
  if (error) throw new Error(`Update ${c.first_name} ${c.last_name}: ${error.message}`);
}

if (dryRun) {
  for (const c of toInsert) console.log(`+ ${c.first_name} ${c.last_name} (${c.company ?? '—'})`);
  console.log(`\n[dry-run] ${toInsert.length} neu, ${updated} aktualisiert, ${unchanged} unverändert`);
  process.exit(0);
}

// Batch-Insert in 100er-Häppchen (PostgREST-Payload klein halten).
for (let i = 0; i < toInsert.length; i += 100) {
  const chunk = toInsert.slice(i, i + 100);
  const { error } = await db.from('contacts').insert(chunk);
  if (error) throw new Error(`Insert (Batch ab ${i}): ${error.message}`);
  inserted += chunk.length;
}

console.log(`${inserted} neu angelegt, ${updated} aktualisiert, ${unchanged} unverändert.`);
