// Pure planner for waiter sections — separated from I/O so it's unit-testable.
//
// tables:  [{ id: string, assignedWaiter: string|'' }]
// waiters: [waiterId, ...]  (currently connected)
// fullShuffle: true → re-randomize everything (new day / manager force);
//              false → sticky: keep tables whose waiter is still connected and
//              hand orphaned/unassigned tables to the least-loaded waiter.
// random: injectable RNG for deterministic tests.
//
// Returns { updates: [{ id, waiter }], load: Map<waiterId, tableCount> }.

const shuffle = (arr, random) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function planAssignments({ tables, waiters, fullShuffle, random = Math.random }) {
  const updates = [];
  const load = new Map(waiters.map((w) => [w, 0]));
  if (waiters.length === 0 || tables.length === 0) return { updates, load };

  if (fullShuffle) {
    const order = shuffle(waiters, random);
    shuffle(tables, random).forEach((table, i) => {
      const wid = order[i % order.length];
      load.set(wid, load.get(wid) + 1);
      if ((table.assignedWaiter || '') !== wid) updates.push({ id: table.id, waiter: wid });
    });
    return { updates, load };
  }

  // Sticky: keep valid assignments, pool the rest.
  const pool = [];
  for (const table of tables) {
    const current = table.assignedWaiter || '';
    if (current && load.has(current)) load.set(current, load.get(current) + 1);
    else pool.push(table);
  }
  for (const table of shuffle(pool, random)) {
    const wid = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
    load.set(wid, load.get(wid) + 1);
    updates.push({ id: table.id, waiter: wid });
  }
  return { updates, load };
}

module.exports = { planAssignments, shuffle };
