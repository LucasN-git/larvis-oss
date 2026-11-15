import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contextProjects,
  groupMachen,
  isMachenEntry,
  machenContextId,
  resolveContextProject,
  type ContextProject,
} from '../src/machen.js';

const proj = (id: string, slug: string, over: Partial<ContextProject> = {}): ContextProject => ({
  id,
  slug,
  name: slug.toUpperCase(),
  parent_id: null,
  status: 'active',
  sort_order: 0,
  deleted_at: null,
  ...over,
});

const PROJECTS = [
  proj('p-werkstatt', 'werkstatt', { sort_order: 2 }),
  proj('p-garten', 'garten', { sort_order: 1 }),
  proj('p-reisen', 'reisen', { status: 'paused', sort_order: 0 }),
  proj('p-sub', 'beet', { parent_id: 'p-garten' }),
  proj('p-kochen', 'kochen', { sort_order: 3 }),
  proj('p-gone', 'alt', { deleted_at: '2026-11-01T00:00:00Z' }),
];

const entry = (id: string, tags: string[], project_id: string | null, created_at: string, over: Record<string, unknown> = {}) => ({
  id,
  tags,
  project_id,
  created_at,
  deleted_at: null as string | null,
  done_at: null as string | null,
  ...over,
});

test('contextProjects: top-level only, active by sort_order, then the rest', () => {
  assert.deepEqual(
    contextProjects(PROJECTS).map((p) => p.slug),
    ['garten', 'werkstatt', 'kochen', 'reisen'],
  );
});

test('isMachenEntry: live, open entries tagged nachmachen or umsetzen; idee stays out', () => {
  assert.equal(isMachenEntry(entry('a', ['nachmachen'], null, '2026-11-01')), true);
  assert.equal(isMachenEntry(entry('a', ['film', 'umsetzen'], null, '2026-11-01')), true);
  assert.equal(isMachenEntry(entry('a', ['idee'], null, '2026-11-01')), false);
  assert.equal(isMachenEntry(entry('a', ['nachmachen'], null, '2026-11-01', { done_at: '2026-11-02' })), false);
  assert.equal(isMachenEntry(entry('a', ['umsetzen'], null, '2026-11-01', { deleted_at: '2026-11-02' })), false);
});

test('machenContextId: own context, else null (none, deleted, sub-project or unknown)', () => {
  assert.equal(machenContextId({ project_id: 'p-garten' }, PROJECTS), 'p-garten');
  assert.equal(machenContextId({ project_id: null }, PROJECTS), null);
  assert.equal(machenContextId({ project_id: 'p-gone' }, PROJECTS), null);
  assert.equal(machenContextId({ project_id: 'p-sub' }, PROJECTS), null);
  assert.equal(machenContextId({ project_id: 'unknown' }, PROJECTS), null);
});

test('groupMachen: groups in Projekte order, only non-empty, newest first, "Ohne Kontext" last', () => {
  const groups = groupMachen(
    [
      entry('old-none', ['nachmachen'], null, '2026-10-01T10:00:00Z'),
      entry('werkstatt', ['umsetzen'], 'p-werkstatt', '2026-10-05T10:00:00Z'),
      entry('new-garten', ['nachmachen'], 'p-garten', '2026-11-01T10:00:00Z'),
      entry('old-garten', ['umsetzen'], 'p-garten', '2026-10-03T10:00:00Z'),
      entry('idee', ['idee'], 'p-garten', '2026-11-03T10:00:00Z'),
      entry('gone', ['umsetzen'], 'p-gone', '2026-10-20T10:00:00Z'),
      entry('done', ['umsetzen'], 'p-kochen', '2026-10-20T10:00:00Z', { done_at: '2026-10-21T10:00:00Z' }),
    ],
    PROJECTS,
  );
  assert.deepEqual(
    groups.map((g) => [g.project?.slug ?? null, g.entries.map((e) => e.id)]),
    [
      ['garten', ['new-garten', 'old-garten']],
      ['werkstatt', ['werkstatt']],
      [null, ['gone', 'old-none']],
    ],
  );
});

test('groupMachen: without any project, entries still show in the "Ohne Kontext" group', () => {
  const groups = groupMachen([entry('x', ['nachmachen'], null, '2026-11-01')], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.project, null);
});

test('resolveContextProject: slug or id of a live top-level project', () => {
  const bySlug = resolveContextProject('garten', PROJECTS);
  assert.ok('project' in bySlug && bySlug.project.id === 'p-garten');
  const byId = resolveContextProject(' p-werkstatt ', PROJECTS);
  assert.ok('project' in byId && byId.project.slug === 'werkstatt');
});

test('resolveContextProject: sub-project, deleted or unknown → error listing valid slugs', () => {
  for (const [input, why] of [
    ['beet', /sub-project/],
    ['alt', /deleted/],
    ['nope', /No project 'nope'/],
  ] as const) {
    const res = resolveContextProject(input, PROJECTS);
    assert.ok('error' in res);
    assert.match(res.error, why);
    assert.match(res.error, /garten, werkstatt, kochen, reisen/);
  }
});
