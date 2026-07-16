const test = require('node:test');
const assert = require('node:assert');
const { distanceMeters, isWithinRadius } = require('../../utils/geo');

const TUNIS = { lat: 36.8065, lng: 10.1815 };

test('distanceMeters: zero for identical points', () => {
  assert.equal(distanceMeters(TUNIS, TUNIS), 0);
});

test('distanceMeters: ~157m for 1e-3 deg lat+lng near Tunis', () => {
  const d = distanceMeters(TUNIS, { lat: TUNIS.lat + 0.001, lng: TUNIS.lng + 0.001 });
  assert.ok(d > 120 && d < 190, `expected ~145-155m, got ${d}`);
});

test('distanceMeters: Tunis -> Sousse is ~115-130 km', () => {
  const SOUSSE = { lat: 35.8256, lng: 10.6369 };
  const d = distanceMeters(TUNIS, SOUSSE);
  assert.ok(d > 110000 && d < 130000, `got ${d}`);
});

test('isWithinRadius: geofence boundary behaviour', () => {
  const near = { lat: TUNIS.lat + 0.0005, lng: TUNIS.lng }; // ~55m north
  assert.equal(isWithinRadius(TUNIS, near, 250), true);
  assert.equal(isWithinRadius(TUNIS, near, 25), false);
});
