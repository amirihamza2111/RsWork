const test = require('node:test');
const assert = require('node:assert');
const { planAssignments } = require('../../utils/sectionAssign');

const tables = (n, assigned = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, assignedWaiter: assigned[`t${i + 1}`] || '' }));

// Applies plan updates over the input to get the final layout.
const finalLayout = (tbls, updates) => {
  const map = new Map(tbls.map((t) => [t.id, t.assignedWaiter]));
  updates.forEach((u) => map.set(u.id, u.waiter));
  return map;
};

test('full shuffle: 5 tables / 2 waiters -> every table assigned, fair 3-2 split', () => {
  const t = tables(5);
  const { updates, load } = planAssignments({ tables: t, waiters: ['X', 'Y'], fullShuffle: true });
  const layout = finalLayout(t, updates);
  assert.ok([...layout.values()].every((w) => w === 'X' || w === 'Y'));
  const counts = [load.get('X'), load.get('Y')].sort();
  assert.deepEqual(counts, [2, 3]);
});

test('full shuffle: single waiter gets everything', () => {
  const { load } = planAssignments({ tables: tables(4), waiters: ['X'], fullShuffle: true });
  assert.equal(load.get('X'), 4);
});

test('sticky: connected waiters keep their tables', () => {
  const t = tables(4, { t1: 'X', t2: 'X', t3: 'Y', t4: 'Y' });
  const { updates } = planAssignments({ tables: t, waiters: ['X', 'Y'], fullShuffle: false });
  assert.equal(updates.length, 0, 'nothing should move when everyone is connected');
});

test('sticky: disconnected waiter\'s tables move to least-loaded remaining waiter', () => {
  // Y went offline; their 2 tables must move to X (only one connected).
  const t = tables(4, { t1: 'X', t2: 'X', t3: 'Y', t4: 'Y' });
  const { updates, load } = planAssignments({ tables: t, waiters: ['X'], fullShuffle: false });
  assert.equal(updates.length, 2);
  assert.ok(updates.every((u) => u.waiter === 'X'));
  assert.equal(load.get('X'), 4);
});

test('sticky: orphaned tables balance across waiters (least-loaded first)', () => {
  // X already has 3; Z is fresh with 0; the 2 unassigned tables should go to Z.
  const t = tables(5, { t1: 'X', t2: 'X', t3: 'X' });
  const { updates, load } = planAssignments({ tables: t, waiters: ['X', 'Z'], fullShuffle: false });
  assert.ok(updates.every((u) => u.waiter === 'Z'), JSON.stringify(updates));
  assert.equal(load.get('X'), 3);
  assert.equal(load.get('Z'), 2);
});

test('no connected waiters -> no changes', () => {
  const { updates } = planAssignments({ tables: tables(3), waiters: [], fullShuffle: true });
  assert.equal(updates.length, 0);
});

test('deterministic with injected RNG', () => {
  const rng = () => 0; // no-op shuffle
  const a = planAssignments({ tables: tables(4), waiters: ['X', 'Y'], fullShuffle: true, random: rng });
  const b = planAssignments({ tables: tables(4), waiters: ['X', 'Y'], fullShuffle: true, random: rng });
  assert.deepEqual(a.updates, b.updates);
});
