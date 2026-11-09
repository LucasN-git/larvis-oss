#!/usr/bin/env node
// vCard-Import: liest einen vCard-Export (iPhone/iCloud, Version 3.0) und legt
// die Kontakte als privat an (source='vcard', business=false).
//
// Dedup-Anker ist der Name (first_name+last_name, case-insensitiv):
// - Mehrere Karten mit demselben Namen in der Datei (iPhone- + WhatsApp-Sync)
//   werden zu einem Kontakt zusammengeführt (Nummern/Mails vereinigt).
// - Existiert der Name schon in der DB (z. B. aus dem LinkedIn-Import), werden
//   nur fehlende Nummern/Mails ergänzt und ein leerer Geburtstag gesetzt —
//   business, Tags, Notizen und alles Handgepflegte bleiben unangetastet.
// - Passt der Name nur auf einen soft-gelöschten Kontakt, wird die Karte
//   übersprungen: der Kontakt wurde bewusst entfernt oder in einen anderen
//   gemergt (merge-duplicates.mjs) und steht im Handy trotzdem noch.
// Der Import ist dadurch beliebig oft wiederholbar.
//
// Karten ohne Nummer, Mail, Geburtstag und Link (nur ein Name, z. B. die
// eigene Karte im Export) werden übersprungen.
//
// Aufruf: node --env-file=.env.local scripts/contacts/import-vcard.mjs [Pfad] [--dry-run]
//   Pfad default: die einzige .vcf in material/
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (root-.env.local).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
let vcfPath = args.find((a) => !a.startsWith('--'));
if (!vcfPath) {
  const candidates = readdirSync('material').filter((f) => f.toLowerCase().endsWith('.vcf'));
  if (candidates.length !== 1) {
    console.error(`Erwarte genau eine .vcf in material/, gefunden: ${candidates.length}. Pfad als Argument angeben.`);
    process.exit(1);
  }
  vcfPath = join('material', candidates[0]);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (root-.env.local, via --env-file laden).');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------- vCard-Parsing ----------

// Fortsetzungszeilen (beginnen mit Space/Tab) an die Vorzeile anhängen (RFC 6350 Folding).
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

const unescapeValue = (v) => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

// Apple-Label ("_$!<Mobile>!$_", "X-Mobil" …) und TEL/EMAIL-Typen auf die
// App-Konvention (deutsch, klein) mappen; unbekannte Labels bleiben wie sie sind.
const LABEL_MAP = new Map([
  ['x-mobil', 'mobil'], ['mobil', 'mobil'], ['mobile', 'mobil'], ['cell', 'mobil'], ['iphone', 'iphone'],
  ['x-privat', 'privat'], ['home', 'privat'], ['privat', 'privat'],
  ['work', 'arbeit'], ['arbeit', 'arbeit'],
  ['whatsapp', 'whatsapp'], ['main', ''], ['voice', ''], ['x-internet', ''], ['internet', ''], ['pref', ''],
]);
function mapLabel(raw) {
  if (!raw) return '';
  const inner = raw.match(/^_\$!<(.+)>!\$_$/)?.[1] ?? raw;
  return LABEL_MAP.get(inner.trim().toLowerCase()) ?? inner.trim();
}

// Dedup-Schlüssel für Telefonnummern: nur Ziffern, deutsche Schreibweisen vereinheitlicht.
function phoneKey(value) {
  let d = value.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  else if (d.startsWith('0')) d = `+49${d.slice(1)}`;
  return d;
}

function parseVcf(text) {
  const cards = [];
  let card = null;
  for (const line of unfold(text).split('\n')) {
    if (/^BEGIN:VCARD/i.test(line)) { card = { tels: [], emails: [], socials: [], labels: new Map() }; continue; }
    if (/^END:VCARD/i.test(line)) { if (card) cards.push(card); card = null; continue; }
    if (!card) continue;
    const m = line.match(/^(?:item(\d+)\.)?([^;:]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const [, group, rawName, rawParams, rawValue] = m;
    const name = rawName.toUpperCase();
    const params = rawParams.toLowerCase();
    const types = [...params.matchAll(/type=([^;:,]+)/g)].map((t) => t[1]);
    const value = rawValue.trim();
    if (name === 'N') card.n = value.split(';').map(unescapeValue);
    else if (name === 'FN') card.fn = unescapeValue(value);
    else if (name === 'TEL' && value) card.tels.push({ group, types, value });
    else if (name === 'EMAIL' && value) card.emails.push({ group, types, value });
    else if (name === 'BDAY') card.bday = value.match(/(\d{4})-(\d{2})-(\d{2})/)?.[0] ?? null;
    else if (name === 'X-SOCIALPROFILE' && /^https?:\/\//i.test(value)) card.socials.push({ types, value });
    else if (name === 'URL' && value) card.socials.push({ types: ['website'], value });
    else if (name === 'X-ABLABEL' && group) card.labels.set(group, value);
  }
  return cards;
}

// Label eines TEL/EMAIL: item-gruppiertes X-ABLabel schlägt die type-Parameter.
function entryLabel(card, entry) {
  const abLabel = entry.group ? card.labels.get(entry.group) : null;
  if (abLabel) return mapLabel(abLabel);
  for (const t of entry.types) {
    const mapped = mapLabel(t);
    if (mapped) return mapped;
  }
  return '';
}

// ---------- Karten → Kontakte (in-Datei-Merge über den Namen) ----------

const cards = parseVcf(readFileSync(vcfPath, 'utf8'));
console.log(`${cards.length} vCards in ${vcfPath}`);

const nameKey = (first, last) => `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}`;

const byName = new Map();
const skippedEmpty = [];
const mergedInFile = [];
for (const card of cards) {
  // N = Nachname;Vorname;Zweitname;Präfix;Suffix — fehlt N, zählt FN als Vorname.
  let [last = '', first = ''] = card.n ?? [];
  if (!first.trim() && !last.trim()) { first = card.fn ?? ''; last = ''; }
  first = first.trim(); last = last.trim();
  if (!first && !last) continue;

  const phones = card.tels.map((t) => ({ label: entryLabel(card, t), value: t.value }));
  const emails = card.emails.map((e) => ({ label: entryLabel(card, e), value: e.value }));
  const links = card.socials.map((s) => ({ label: mapLabel(s.types[0] ?? '') || 'link', url: s.value }));

  if (!phones.length && !emails.length && !card.bday && !links.length) {
    skippedEmpty.push(`${first} ${last}`.trim());
    continue;
  }

  // Apple exportiert Geburtstage ohne bekanntes Jahr mit Platzhalter-Jahr 1604.
  const birthday = card.bday ?? null;
  const birthdayYearKnown = birthday ? !birthday.startsWith('1604') : true;

  const key = nameKey(first, last);
  const existing = byName.get(key);
  if (!existing) {
    byName.set(key, { first_name: first, last_name: last, phones, emails, links, birthday, birthday_year_known: birthdayYearKnown });
    continue;
  }
  mergedInFile.push(`${first} ${last}`.trim());
  const phoneKeys = new Set(existing.phones.map((p) => phoneKey(p.value)));
  for (const p of phones) if (!phoneKeys.has(phoneKey(p.value))) { existing.phones.push(p); phoneKeys.add(phoneKey(p.value)); }
  const emailKeys = new Set(existing.emails.map((e) => e.value.toLowerCase()));
  for (const e of emails) if (!emailKeys.has(e.value.toLowerCase())) { existing.emails.push(e); emailKeys.add(e.value.toLowerCase()); }
  const urlKeys = new Set(existing.links.map((l) => l.url));
  for (const l of links) if (!urlKeys.has(l.url)) { existing.links.push(l); urlKeys.add(l.url); }
  if (!existing.birthday && birthday) { existing.birthday = birthday; existing.birthday_year_known = birthdayYearKnown; }
}

if (skippedEmpty.length) console.log(`übersprungen (nur Name, keine Daten): ${skippedEmpty.join(', ')}`);
if (mergedInFile.length) console.log(`in der Datei zusammengeführt: ${[...new Set(mergedInFile)].join(', ')}`);

// ---------- Abgleich mit der DB ----------

const { data: existing, error: exErr } = await db
  .from('contacts')
  .select('id,first_name,last_name,phones,emails,birthday,birthday_year_known,deleted_at');
if (exErr) throw new Error(exErr.message);
// Ein lebender Kontakt schlägt einen gleichnamigen soft-gelöschten.
const dbByName = new Map();
for (const c of existing) {
  const key = nameKey(c.first_name, c.last_name);
  const prev = dbByName.get(key);
  if (!prev || (prev.deleted_at && !c.deleted_at)) dbByName.set(key, c);
}

const toInsert = [];
const skippedDeleted = [];
let updated = 0;
let unchanged = 0;

for (const c of byName.values()) {
  const found = dbByName.get(nameKey(c.first_name, c.last_name));
  if (found?.deleted_at) {
    skippedDeleted.push(`${c.first_name} ${c.last_name}`.trim());
    continue;
  }
  if (!found) {
    toInsert.push({ ...c, source: 'vcard', business: false });
    continue;
  }
  const patch = {};
  const phoneKeys = new Set((found.phones ?? []).map((p) => phoneKey(p.value)));
  const newPhones = c.phones.filter((p) => !phoneKeys.has(phoneKey(p.value)));
  if (newPhones.length) patch.phones = [...(found.phones ?? []), ...newPhones];
  const emailKeys = new Set((found.emails ?? []).map((e) => e.value.toLowerCase()));
  const newEmails = c.emails.filter((e) => !emailKeys.has(e.value.toLowerCase()));
  if (newEmails.length) patch.emails = [...(found.emails ?? []), ...newEmails];
  if (!found.birthday && c.birthday) {
    patch.birthday = c.birthday;
    patch.birthday_year_known = c.birthday_year_known;
  }
  if (Object.keys(patch).length === 0) { unchanged++; continue; }
  updated++;
  const parts = [];
  if (newPhones.length) parts.push(`+${newPhones.length} Nummer(n)`);
  if (newEmails.length) parts.push(`+${newEmails.length} Mail(s)`);
  if (patch.birthday) parts.push('Geburtstag');
  console.log(`~ ${c.first_name} ${c.last_name}: ${parts.join(', ')}`);
  if (dryRun) continue;
  const { error } = await db.from('contacts').update(patch).eq('id', found.id);
  if (error) throw new Error(`Update ${c.first_name} ${c.last_name}: ${error.message}`);
}

if (skippedDeleted.length) console.log(`übersprungen (in der App gelöscht/gemergt): ${skippedDeleted.join(', ')}`);

if (dryRun) {
  for (const c of toInsert) console.log(`+ ${c.first_name} ${c.last_name} (${c.phones.length} Nummer(n), ${c.emails.length} Mail(s)${c.birthday ? ', Geburtstag' : ''})`);
  console.log(`\n[dry-run] ${toInsert.length} neu, ${updated} aktualisiert, ${unchanged} unverändert, ${skippedDeleted.length} übersprungen (gelöscht)`);
  process.exit(0);
}

// Batch-Insert in 100er-Häppchen (PostgREST-Payload klein halten).
let inserted = 0;
for (let i = 0; i < toInsert.length; i += 100) {
  const chunk = toInsert.slice(i, i + 100);
  const { error } = await db.from('contacts').insert(chunk);
  if (error) throw new Error(`Insert (Batch ab ${i}): ${error.message}`);
  inserted += chunk.length;
}

console.log(`${inserted} neu angelegt (privat), ${updated} aktualisiert, ${unchanged} unverändert.`);
