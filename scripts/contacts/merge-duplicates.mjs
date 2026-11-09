#!/usr/bin/env node
// Dubletten-Merge nach einem Import: führt Kontakte zusammen, die dieselbe
// Person unter zwei Namen sind (typisch: WhatsApp-Kurzname aus dem vCard-Import
// neben dem vollen Namen aus dem LinkedIn-Import).
//
// Automatisch zusammengeführt wird nur bei starker Evidenz:
// 1. Voller Namens-Match: Vor- UND Nachname des LinkedIn-Kontakts stecken in
//    den Namens-Tokens des vCard-Kontakts (diakritik-/case-gefaltet, Füll-Tokens
//    wie "WI"/Emoji ignoriert) — z. B. "Max Mustermann Maxi WI🚀".
// 2. Firmen-Match: Vorname gleich und der vCard-Name enthält ein Firmen-Token
//    des LinkedIn-Kontakts — z. B. "Erika Beispiel AG" ↔ Erika Musterfrau @ Beispiel AG.
// 3. Nummern-Match: zwei Kontakte teilen eine Telefonnummer und haben denselben
//    Vornamen (bzw. der eine Name erweitert den anderen nur um Füll-Tokens).
//
// Der Kontakt mit den LinkedIn-/Volldaten überlebt, Nummern/Mails/Geburtstag
// des Duplikats werden übernommen, das Duplikat wird soft-gelöscht
// (deleted_at, per restore_contact wiederherstellbar). Ein Notiz-Zusatz am
// Überlebenden dokumentiert den Merge.
//
// Alles Unsichere (nur Vorname stimmt überein, geteilte Nummer bei anderem
// Vornamen) wird NICHT gemergt, sondern als Review-Liste (Markdown) ausgegeben.
//
// Von Hand abgelehnte Zuordnungen stehen in rejected-pairs.json (neben diesem
// Skript) und werden nie wieder vorgeschlagen — candidate "*" lehnt alle
// Kandidaten für diesen Kontaktnamen ab. Geteilte-Nummer-Evidenz (Stufe 3)
// schlägt eine Ablehnung, weil sie stärker ist als der Namensvergleich.
//
// Aufruf: node --env-file=.env.local scripts/contacts/merge-duplicates.mjs [--apply]
//   ohne --apply: Dry-Run, zeigt nur, was passieren würde.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (root-.env.local).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');

let rejectedPairs = [];
try {
  rejectedPairs = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'rejected-pairs.json'), 'utf8'));
} catch { /* keine Ablehnungen gespeichert */ }

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (root-.env.local, via --env-file laden).');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------- Normalisierung ----------

// Füll-Tokens, die keine Namensinformation tragen (Kontext-Marker im Handy-Adressbuch).
const NOISE_TOKENS = new Set(['neu', 'alt', 'alte', 'nummer', 'handy', 'mobil', '2', 'x']);
// Firmen-Tokens, die zu generisch für einen Match sind.
const COMPANY_STOPWORDS = new Set(['gmbh', 'co', 'kg', 'ag', 'ev', 'e.v', 'und', 'the', 'für', 'group', 'gruppe', 'consulting', 'gmbh&co', 'holding', 'stiftung', 'deutschland', 'universität', 'university']);

const fold = (s) => s
  .toLowerCase()
  .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');

const tokenize = (s) => fold(s)
  .split(/[\s\-–.,/]+/)
  .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
  .filter((t) => t.length > 0);

const nameTokens = (c) => tokenize(`${c.first_name} ${c.last_name}`).filter((t) => !NOISE_TOKENS.has(t));
const firstToken = (c) => tokenize(c.first_name)[0] ?? tokenize(c.last_name)[0] ?? '';

function phoneKey(value) {
  let d = value.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  else if (d.startsWith('0')) d = `+49${d.slice(1)}`;
  return d;
}

const displayName = (c) => `${c.first_name} ${c.last_name}`.trim();

const normName = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const isRejected = (v, l) => rejectedPairs.some((r) =>
  normName(r.contact) === normName(displayName(v)) &&
  (r.candidate === '*' || normName(r.candidate) === normName(displayName(l))));

// Tippfehler-Toleranz: Edit-Distanz ≤ 1 (nur für Tokens ab 5 Zeichen benutzen).
function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === t[i]) i++;
  if (s.length === t.length) return s.slice(i + 1) === t.slice(i + 1);
  return s.slice(i) === t.slice(i + 1);
}

const commonPrefixLen = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

// ---------- Kontakte laden ----------

const { data: contacts, error } = await db
  .from('contacts')
  .select('id,first_name,last_name,nickname,phones,emails,birthday,birthday_year_known,company,position,linkedin_url,notes_md,source,business')
  .is('deleted_at', null);
if (error) throw new Error(error.message);

const vcards = contacts.filter((c) => c.source === 'vcard');
const fullProfiles = contacts.filter((c) => c.source !== 'vcard');

// ---------- Stufe 1+2: vCard ↔ LinkedIn/manual mit starker Evidenz ----------

// pairs: [duplikat (wird gelöscht), überlebender, begründung]
const pairs = [];
const matchedVcardIds = new Set();

for (const v of vcards) {
  const vTokens = new Set(nameTokens(v));
  const candidates = [];
  for (const l of fullProfiles) {
    if (isRejected(v, l)) continue;
    const lFirst = firstToken(l);
    if (!lFirst || !vTokens.has(lFirst)) continue;
    const lastTokens = tokenize(l.last_name);
    if (lastTokens.length && lastTokens.every((t) => vTokens.has(t))) {
      candidates.push([l, 'voller Namens-Match']);
      continue;
    }
    const companyTokens = tokenize(l.company ?? '').filter((t) => t.length >= 4 && !COMPANY_STOPWORDS.has(t));
    if (companyTokens.some((t) => vTokens.has(t))) candidates.push([l, `Firmen-Match (${l.company})`]);
  }
  if (candidates.length === 1) {
    pairs.push([v, candidates[0][0], candidates[0][1]]);
    matchedVcardIds.add(v.id);
  } else if (candidates.length > 1) {
    console.log(`! mehrdeutig, übersprungen: ${displayName(v)} ↔ ${candidates.map(([l]) => displayName(l)).join(' / ')}`);
  }
}

// ---------- Stufe 3: geteilte Telefonnummer ----------

const byPhone = new Map();
for (const c of contacts) {
  if (matchedVcardIds.has(c.id)) continue;
  for (const p of c.phones ?? []) {
    const key = phoneKey(p.value);
    if (!byPhone.has(key)) byPhone.set(key, []);
    if (!byPhone.get(key).includes(c)) byPhone.get(key).push(c);
  }
}

// Kontakte, die schon in einem Stufe-1/2-Paar stecken (Duplikat ODER
// Überlebender), dürfen in Stufe 3 nicht erneut gepaart werden — sonst kann
// ein Überlebender gleich wieder als Duplikat soft-gelöscht werden.
const pairedIds = new Set(pairs.flatMap(([d, s]) => [d.id, s.id]));

const reviewSharedPhone = [];
const phonePaired = new Set();
for (const [key, group] of byPhone) {
  if (group.length < 2) continue;
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const [a, b] = [group[i], group[j]];
    if (pairedIds.has(a.id) || pairedIds.has(b.id)) continue;
    if (phonePaired.has(`${a.id}|${b.id}`)) continue;
    phonePaired.add(`${a.id}|${b.id}`);
    // Subset/Superset auf den rohen Tokens (ohne Füll-Token-Filter), damit
    // "Max Neu Mustermann" als Obermenge von "Max Mustermann" erkannt wird.
    const [aT, bT] = [new Set(tokenize(`${a.first_name} ${a.last_name}`)), new Set(tokenize(`${b.first_name} ${b.last_name}`))];
    const sameFirst = firstToken(a) === firstToken(b);
    const subset = [...aT].every((t) => bT.has(t)) ? [a, b] : [...bT].every((t) => aT.has(t)) ? [b, a] : null;
    if (sameFirst && subset) {
      // Überlebender: der Name mit mehr Information — außer die Zusatz-Tokens
      // sind reine Füll-Tokens ("Neu", "2" …), dann gewinnt der Kurzname.
      const [sub, sup] = subset;
      const subTokens = new Set(tokenize(`${sub.first_name} ${sub.last_name}`));
      const extras = [...tokenize(`${sup.first_name} ${sup.last_name}`)].filter((t) => !subTokens.has(t));
      const survivor = extras.every((t) => NOISE_TOKENS.has(t)) ? sub : sup;
      const duplicate = survivor === sub ? sup : sub;
      pairs.push([duplicate, survivor, `geteilte Nummer ${key}`]);
      pairedIds.add(duplicate.id); pairedIds.add(survivor.id);
    } else {
      reviewSharedPhone.push([a, b, key]);
    }
  }
}

// ---------- Stufe 4 (nur Review): Vorname passt, Nachname widerspricht nicht ----------

// Ein Paar ist nur dann ein Kandidat, wenn der vCard-Name dem Kandidaten nicht
// widerspricht. Betrachtet werden alle Namens-Tokens nach dem Vornamen (egal ob
// sie im first_name- oder last_name-Feld stehen — WhatsApp-Namen liegen oft
// komplett im Vornamensfeld): keine Zusatz-Tokens nach Füll-Token-Filter ist ok,
// ein Token muss sonst im Namen des Kandidaten vorkommen, oder ein einzelner
// Buchstabe passt als Initiale auf dessen Nachnamen ("Max M." ↔ Max Mustermann).
// "Max Beispiel" ↔ Max Mustermann fliegt damit raus: sicher zwei Personen.
const vcardExtraTokens = (v) => tokenize(`${v.first_name} ${v.last_name}`).slice(1).filter((t) => !NOISE_TOKENS.has(t));

function lastNameCompatible(v, l) {
  const vExtra = vcardExtraTokens(v);
  if (vExtra.length === 0) return true;
  const lTokens = tokenize(`${l.first_name} ${l.last_name}`);
  const lLast = tokenize(l.last_name);
  return vExtra.some((t) =>
    // exakt, oder Tippfehler ("Hoffmann" ↔ "Hopfmann")
    lTokens.some((lt) => lt === t || (t.length >= 5 && lt.length >= 5 && withinOneEdit(t, lt)))
    // Initiale in eine der beiden Richtungen ("Max M." ↔ Mustermann, "Erika Muster" ↔ "E. M.")
    || (t.length === 1 && lLast.some((lt) => lt.startsWith(t)))
    || lLast.some((lt) => lt.length === 1 && t.startsWith(lt)));
}

const mergedIds = new Set(pairs.flatMap(([d, s]) => [d.id, s.id]));
const reviewFirstName = [];
for (const v of vcards) {
  if (matchedVcardIds.has(v.id) || mergedIds.has(v.id)) continue;
  const vFirst = firstToken(v);
  if (!vFirst) continue;
  const hits = fullProfiles.filter((l) => {
    if (mergedIds.has(l.id) || isRejected(v, l)) return false;
    // Vorname matcht jedes Vornamens-Token des Kandidaten ("Arne" ↔ "Jan-Arne"),
    // Kose-/Kurzformen über gemeinsames Präfix ("Max" ↔ "Maximilian", "Josi" ↔ "Josephine").
    const lFirsts = tokenize(l.first_name);
    const exactFirst = lFirsts.includes(vFirst);
    const prefixFirst = lFirsts.some((ft) => ft.length >= 3 && vFirst.length >= 3 && commonPrefixLen(ft, vFirst) >= 3);
    if (!exactFirst && !prefixFirst) return false;
    // Präfix-Vornamen zählen nur mit bestätigendem Nachnamen, sonst zu vage.
    if (!exactFirst && vcardExtraTokens(v).length === 0) return false;
    return lastNameCompatible(v, l);
  });
  if (hits.length >= 1) reviewFirstName.push([v, hits]);
}

// ---------- Ausgabe / Anwendung ----------

console.log(`\n${pairs.length} sichere Merges:`);
for (const [dup, surv, reason] of pairs) {
  console.log(`  „${displayName(dup)}" → „${displayName(surv)}" [${surv.source}] (${reason})`);
}

if (apply) {
  for (const [dup, pairedSurv, reason] of pairs) {
    // Überlebenden frisch lesen: der Ladestand von oben veraltet, sobald ein
    // Kontakt in mehreren Paaren vorkommt — sonst überschreibt der zweite
    // Merge die Nummern und Notizen des ersten.
    const { data: surv, error: fetchErr } = await db.from('contacts').select('*').eq('id', pairedSurv.id).single();
    if (fetchErr) throw new Error(`Lesen ${displayName(pairedSurv)}: ${fetchErr.message}`);
    const phoneKeys = new Set((surv.phones ?? []).map((p) => phoneKey(p.value)));
    const phones = [...(surv.phones ?? []), ...(dup.phones ?? []).filter((p) => !phoneKeys.has(phoneKey(p.value)))];
    const emailKeys = new Set((surv.emails ?? []).map((e) => e.value.toLowerCase()));
    const emails = [...(surv.emails ?? []), ...(dup.emails ?? []).filter((e) => !emailKeys.has(e.value.toLowerCase()))];
    const note = `Zusammengeführt mit „${displayName(dup)}" (${dup.source}-Import, ${reason}).`;
    const patch = {
      phones, emails,
      notes_md: [surv.notes_md?.trim(), note].filter(Boolean).join('\n\n'),
    };
    if (!surv.birthday && dup.birthday) { patch.birthday = dup.birthday; patch.birthday_year_known = dup.birthday_year_known; }
    if (!surv.nickname && dup.nickname) patch.nickname = dup.nickname;
    const { error: upErr } = await db.from('contacts').update(patch).eq('id', surv.id);
    if (upErr) throw new Error(`Update ${displayName(surv)}: ${upErr.message}`);
    const { error: delErr } = await db.from('contacts').update({ deleted_at: new Date().toISOString() }).eq('id', dup.id);
    if (delErr) throw new Error(`Soft-Delete ${displayName(dup)}: ${delErr.message}`);
  }
  console.log('→ angewendet.');
} else {
  console.log('→ Dry-Run, nichts geändert. Anwenden mit --apply.');
}

// Review-Liste als Markdown (für die Larvis-Inbox / manuelle Durchsicht).
console.log('\n----- REVIEW-MARKDOWN -----');
if (reviewSharedPhone.length) {
  console.log('**Gleiche Nummer, unterschiedlicher Name** (vermutlich dieselbe Person oder gleicher Haushalt):');
  for (const [a, b, key] of reviewSharedPhone) console.log(`- [ ] „${displayName(a)}" ↔ „${displayName(b)}" (${key})`);
  console.log('');
}
const unique = reviewFirstName.filter(([, hits]) => hits.length === 1);
const ambiguous = reviewFirstName.filter(([, hits]) => hits.length > 1);
if (unique.length) {
  console.log('**Vorname passt auf genau einen LinkedIn-Kontakt** (könnte dieselbe Person sein):');
  for (const [v, [l]] of unique) console.log(`- [ ] „${displayName(v)}" ↔ ${displayName(l)}${l.company ? ` (${l.company})` : ''}`);
  console.log('');
}
if (ambiguous.length) {
  console.log('**Vorname passt auf mehrere LinkedIn-Kontakte:**');
  for (const [v, hits] of ambiguous) console.log(`- [ ] „${displayName(v)}" ↔ ${hits.map((l) => displayName(l)).join(' / ')}`);
}
