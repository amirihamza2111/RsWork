const { sql } = require('../config/db');

// Joins SQL fragments with AND; an empty list matches everything.
const and = (conditions) => {
  const parts = conditions.filter(Boolean);
  if (parts.length === 0) return sql`true`;
  return parts.reduce((acc, part) => sql`${acc} and ${part}`);
};

// Drops undefined keys so partial updates only touch provided columns.
const compact = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));

const unique = (values) => [...new Set(values.filter(Boolean).map(String))];

// Partial UPDATE by primary key; returns the updated row or null.
const updateById = async (table, id, patch, db = sql) => {
  const values = compact(patch);
  if (Object.keys(values).length === 0) {
    const [row] = await db`select * from ${db(table)} where id = ${id}`;
    return row || null;
  }
  const [row] = await db`
    update ${db(table)} set ${db(values)} where id = ${id} returning *
  `;
  return row || null;
};

// Rows of `table` whose id is in `ids`, keyed by id.
const byIds = async (table, ids, columns = null, db = sql) => {
  const list = unique(ids);
  if (list.length === 0) return new Map();
  const rows = columns
    ? await db`select ${db(columns)} from ${db(table)} where id in ${db(list)}`
    : await db`select * from ${db(table)} where id in ${db(list)}`;
  return new Map(rows.map((row) => [row.id, row]));
};

module.exports = { sql, and, compact, unique, updateById, byIds };
