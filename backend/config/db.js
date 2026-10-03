const postgres = require('postgres');
const config = require('./index');

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(config.supabase.dbUrl);

// Supabase pooler (transaction mode) does not support prepared statements.
const sql = postgres(config.supabase.dbUrl, {
  prepare: false,
  ssl: isLocal ? false : 'require',
  max: Number(process.env.DB_POOL_MAX) || 10,
  idle_timeout: 20,
  transform: { column: { from: postgres.toCamel } },
  types: {
    numeric: {
      to: 1700,
      from: [1700],
      serialize: (value) => String(value),
      parse: (value) => Number(value),
    },
    bigint: {
      to: 20,
      from: [20],
      serialize: (value) => String(value),
      parse: (value) => Number(value),
    },
  },
});

const connectDB = async () => {
  try {
    await sql`select 1`;
    console.log('Postgres connected (Supabase)');
  } catch (error) {
    console.error('Postgres connection error:', error.message);
    process.exit(1);
  }
};

module.exports = { sql, connectDB };
