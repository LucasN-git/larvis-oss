import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCanteens } from '../src/mensa.js';
import { parseWeatherLocation } from '../src/weather.js';

test('parseWeatherLocation: vollständige Angaben ergeben einen Ort', () => {
  assert.deepEqual(parseWeatherLocation(' Beispielstadt ', '50.1', '8.25'), { name: 'Beispielstadt', lat: 50.1, lon: 8.25 });
  assert.deepEqual(parseWeatherLocation('Ort', '51,96', '7,62'), { name: 'Ort', lat: 51.96, lon: 7.62 });
});

test('parseWeatherLocation: fehlende oder ungültige Angaben ergeben null', () => {
  assert.equal(parseWeatherLocation(undefined, undefined, undefined), null);
  assert.equal(parseWeatherLocation('Ort', '', '8'), null);
  assert.equal(parseWeatherLocation('', '50', '8'), null);
  assert.equal(parseWeatherLocation('Ort', 'abc', '8'), null);
  assert.equal(parseWeatherLocation('Ort', '95', '8'), null);
  assert.equal(parseWeatherLocation('Ort', '51.9x', '8'), null);
});

test('parseCanteens: Id mit optionalem Namen, erste ist Standard', () => {
  assert.deepEqual(parseCanteens('101=Mensa Nord, 202 ,303=Café = Bar'), [
    { id: 101, name: 'Mensa Nord' },
    { id: 202, name: 'Mensa 202' },
    { id: 303, name: 'Café = Bar' },
  ]);
});

test('parseCanteens: leer, ungültig und doppelt fällt weg', () => {
  assert.deepEqual(parseCanteens(undefined), []);
  assert.deepEqual(parseCanteens(''), []);
  assert.deepEqual(parseCanteens('abc,0,-5,7=A,7=B'), [{ id: 7, name: 'A' }]);
});
