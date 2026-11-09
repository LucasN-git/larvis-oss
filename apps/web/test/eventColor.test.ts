import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectColorMap } from '@larvis/shared';
import { eventColorOf } from '../src/features/calendar/eventColor';

const colorMap = projectColorMap([
  { id: 'p', parent_id: null, color: '#14B8A6' },
  { id: 'sub', parent_id: 'p', color: null },
  { id: 'bare', parent_id: null, color: null },
]);

test('project colour wins, inherited for sub-projects', () => {
  assert.equal(eventColorOf({ project_id: 'p', calendar: 'primary', color: '#123456' }, colorMap), '#14B8A6');
  assert.equal(eventColorOf({ project_id: 'sub', calendar: 'larvis', color: null }, colorMap), '#14B8A6');
});

test('without project colour: Larvis calendar → accent', () => {
  assert.equal(eventColorOf({ project_id: 'bare', calendar: 'larvis', color: '#123456' }, colorMap), 'var(--accent)');
  assert.equal(eventColorOf({ project_id: null, calendar: 'larvis', color: null }, colorMap), 'var(--accent)');
});

test('external calendars keep their own colour, else faint', () => {
  assert.equal(eventColorOf({ project_id: null, calendar: 'primary', color: '#123456' }, colorMap), '#123456');
  assert.equal(eventColorOf({ project_id: 'unknown', calendar: 'primary', color: null }, colorMap), 'var(--text-faint)');
});

test('Kalender-Abo: mit Projekt die Projektfarbe, ohne (oder Projekt ohne Farbe) die Abo-Farbe', () => {
  assert.equal(eventColorOf({ project_id: 'sub', calendar: 'subscription', color: '#0078d4' }, colorMap), '#14B8A6');
  assert.equal(eventColorOf({ project_id: null, calendar: 'subscription', color: '#0078d4' }, colorMap), '#0078d4');
  assert.equal(eventColorOf({ project_id: 'bare', calendar: 'subscription', color: '#0078d4' }, colorMap), '#0078d4');
});
