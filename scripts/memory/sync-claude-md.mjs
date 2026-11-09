#!/usr/bin/env node
// Spiegelt alle Memories aus Supabase nach ~/.claude/globals/larvis-memories.md.
// Die globale CLAUDE.md bindet die Datei per @-Referenz ein — Claude-Agenten
// haben die Memories damit ohne MCP-Call im Kontext. Source of Truth ist die
// Tabelle public.memories (Web-App /profil → Memory, MCP-Tools save/delete_memory).
//
// Läuft standalone von überall (lädt die Repo-.env.local selbst) — gedacht für
// den SessionStart-Hook in ~/.claude/settings.json und für manuelle Aufrufe:
//   node scripts/memory/sync-claude-md.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = join(homedir(), '.claude', 'globals', 'larvis-memories.md');

// .env.local nur als Fallback lesen — gesetzte Env-Variablen gewinnen.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    for (const line of readFileSync(join(repoRoot, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // keine .env.local — unten schlägt der Env-Check an
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('[memory-sync] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (.env.local im Larvis-Repo?).');
  process.exit(1);
}

const res = await fetch(
  `${url}/rest/v1/memories?select=slug,title,content_md,kind,scope,updated_at&order=title.asc`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!res.ok) {
  console.error(`[memory-sync] Supabase-Fehler ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const memories = await res.json();

// Reihenfolge + Überschriften analog MEMORY_KIND_LABELS in @larvis/shared.
const KINDS = [
  ['user', 'Über mich'],
  ['feedback', 'Arbeitsweise'],
  ['project', 'Projekte'],
  ['reference', 'Referenzen'],
  ['skill', 'Skills'],
];

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const lines = [
  '# Larvis-Memory (auto-generiert)',
  '',
  `> Stand: ${stamp} UTC · ${memories.length} Einträge · Quelle: Larvis-App → Profil → Memory.`,
  '> NICHT von Hand editieren — dieser File wird vom Sync überschrieben',
  '> (scripts/memory/sync-claude-md.mjs im Larvis-Repo). Neue dauerhafte Fakten,',
  '> Präferenzen oder Korrekturen des Nutzers: mit dem Larvis-MCP-Tool `save_memory`',
  '> speichern (kurz, ein Fakt pro Memory); der Sync holt sie dann hierher.',
  '',
];

for (const [kind, heading] of KINDS) {
  const group = memories.filter((m) => m.kind === kind);
  if (!group.length) continue;
  lines.push(`## ${heading}`, '');
  for (const m of group) {
    lines.push(`### ${m.title}${m.scope ? ` (Scope: ${m.scope})` : ''}`);
    if (m.content_md.trim()) lines.push(m.content_md.trim());
    lines.push('');
  }
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, lines.join('\n'));
console.log(`[memory-sync] ${memories.length} Memories -> ${target}`);
