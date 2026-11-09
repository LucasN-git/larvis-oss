import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Place } from '@larvis/shared';
import { matchPlace, placeHint } from '../src/features/places/matchPlace';

function place(partial: Partial<Place> & Pick<Place, 'id' | 'name'>): Place {
  return {
    address: '',
    city: '',
    travel_minutes: null,
    notes_md: '',
    aliases: [],
    created_at: '2026-10-12T00:00:00Z',
    updated_at: '2026-10-12T00:00:00Z',
    deleted_at: null,
    ...partial,
  };
}

const kunde = place({ id: 'kunde', name: 'Kunde Beispielstadt', city: 'Beispielstadt', travel_minutes: 60, aliases: ['Kunde', 'Beispiel GmbH'] });
const office = place({ id: 'office', name: 'Beispiel Office', aliases: ['Büro', 'Office'] });
const old = place({ id: 'old', name: 'Alte Halle', aliases: ['Halle'], deleted_at: '2026-10-01T00:00:00Z' });
const places = [kunde, office, old];

test('matches the place name exactly', () => {
  assert.equal(matchPlace('Kunde Beispielstadt', places)?.id, 'kunde');
});

test('matches an alias', () => {
  assert.equal(matchPlace('Büro', places)?.id, 'office');
  assert.equal(matchPlace('Beispiel GmbH', places)?.id, 'kunde');
});

test('ignores case and surrounding whitespace', () => {
  assert.equal(matchPlace('  kunde beispielstadt ', places)?.id, 'kunde');
  assert.equal(matchPlace('OFFICE', places)?.id, 'office');
});

test('returns null without an exact match', () => {
  assert.equal(matchPlace('Kunde Halle 3', places), null);
  assert.equal(matchPlace('', places), null);
  assert.equal(matchPlace('   ', places), null);
  assert.equal(matchPlace(null, places), null);
});

test('ignores deleted places', () => {
  assert.equal(matchPlace('Alte Halle', places), null);
  assert.equal(matchPlace('Halle', places), null);
});

test('hint shows the drive time only when known', () => {
  assert.equal(placeHint(kunde), 'Kunde Beispielstadt · 60 min Fahrt');
  assert.equal(placeHint(office), 'Beispiel Office');
});
