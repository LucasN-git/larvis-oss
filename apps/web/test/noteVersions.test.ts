import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Note, NoteGraph } from '@larvis/shared';
import {
  READ_MODE_MIN_CHARS,
  currentNotesOnly,
  currentOfSeries,
  initialNoteMode,
  versionChipLabel,
  versionDate,
} from '../src/features/notes/noteVersions';

process.env.TZ = 'Europe/Berlin';

const graph: NoteGraph = {
  nodes: [{ id: 'zutat', label: 'Zutat', group: 'zutat', x: 10, y: 20 }],
  edges: [],
  groups: { zutat: 'Zutat' },
};

function note(over: Partial<Note>): Note {
  return {
    id: 'n1',
    project_id: 'p1',
    parent_id: 'folder',
    area: 'project',
    title: 'Jahresrückblick',
    body_md: 'Text',
    tags: ['rueckblick'],
    sort_order: 3,
    created_at: '2026-06-01T10:00:00Z',
    updated_at: '2026-06-01T10:00:00Z',
    archived_at: null,
    deleted_at: null,
    icon: '🗺️',
    series_id: 's1',
    version_no: 1,
    previous_version_id: null,
    superseded_at: null,
    graph,
    ...over,
  };
}

test('Baum zeigt von einer Serie nur die aktuelle Version', () => {
  const v1 = note({ id: 'v1', version_no: 1, superseded_at: '2026-10-13T08:00:00Z' });
  const v2 = note({ id: 'v2', version_no: 2 });
  const other = note({ id: 'x', series_id: 's2' });
  assert.deepEqual(currentNotesOnly([v1, v2, other]).map((n) => n.id), ['v2', 'x']);
});

test('aktuelle Version einer Serie', () => {
  const series = [
    note({ id: 'v2', version_no: 2 }),
    note({ id: 'v1', version_no: 1, superseded_at: '2026-06-01T00:00:00Z' }),
  ];
  assert.equal(currentOfSeries(series)?.id, 'v2');
  // Alle eingefroren (sollte nicht vorkommen): die höchste Nummer gilt.
  const frozen = series.map((n) => ({ ...n, superseded_at: '2026-10-01T00:00:00Z' }));
  assert.equal(currentOfSeries(frozen)?.id, 'v2');
});

test('Startansicht: eingefroren oder lang → Lesen, sonst Bearbeiten', () => {
  assert.equal(initialNoteMode(null), 'edit');
  assert.equal(initialNoteMode(note({ body_md: 'kurz' })), 'edit');
  assert.equal(initialNoteMode(note({ body_md: 'x'.repeat(READ_MODE_MIN_CHARS + 1) })), 'read');
  assert.equal(initialNoteMode(note({ body_md: 'kurz', superseded_at: '2026-10-13T08:00:00Z' })), 'read');
});

test('Beschriftungen der Versionen', () => {
  assert.equal(versionChipLabel(note({ version_no: 1, created_at: '2026-06-15T10:00:00Z' })), 'v1 · Jun 2026');
  assert.equal(versionChipLabel(note({ version_no: 2, created_at: '2026-10-13T10:00:00Z' })), 'v2 · Okt 2026');
  assert.equal(versionDate(note({ created_at: '2026-10-13T10:00:00Z' })), '13.10.2026');
});
