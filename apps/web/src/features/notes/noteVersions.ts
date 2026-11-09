import type { Note } from '@larvis/shared';

// Reine Regeln der Notiz-Versionen (ohne Supabase), testbar. Was eine Serie ist, steht
// bei den Feldern von Note in @larvis/shared; der Versionswechsel liegt in der Datenbank.

/** Ab dieser Länge öffnet eine Notiz im Lesemodus statt im Editor. */
export const READ_MODE_MIN_CHARS = 1500;

export type NoteMode = 'read' | 'edit' | 'graph';

/** Nur aktuelle Versionen: der Notizbaum zeigt von jeder Serie genau eine Notiz. */
export function currentNotesOnly<T extends Pick<Note, 'superseded_at'>>(notes: T[]): T[] {
  return notes.filter((n) => !n.superseded_at);
}

/** Startansicht: eingefrorene oder lange Notizen öffnen zum Lesen, alles andere im Editor. */
export function initialNoteMode(note: Pick<Note, 'superseded_at' | 'body_md'> | null): NoteMode {
  if (!note) return 'edit';
  if (note.superseded_at) return 'read';
  return note.body_md.length > READ_MODE_MIN_CHARS ? 'read' : 'edit';
}

export function sortSeries<T extends Pick<Note, 'version_no'>>(series: T[]): T[] {
  return [...series].sort((a, b) => a.version_no - b.version_no);
}

/** Die aktuelle Version einer Serie (ohne superseded_at); fehlt sie, die höchste Nummer. */
export function currentOfSeries<T extends Pick<Note, 'version_no' | 'superseded_at'>>(series: T[]): T | undefined {
  const sorted = sortSeries(series);
  return sorted.find((n) => !n.superseded_at) ?? sorted[sorted.length - 1];
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Chip-Beschriftung, z. B. „v2 · Okt 2026" (Monat der Anlage der Version). */
export function versionChipLabel(note: Pick<Note, 'version_no' | 'created_at'>): string {
  const d = new Date(note.created_at);
  return `v${note.version_no} · ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function versionDate(note: Pick<Note, 'created_at'>): string {
  const d = new Date(note.created_at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
