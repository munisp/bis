import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.BIS_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
  console.error('BIS_DATABASE_URL or DATABASE_URL must be a PostgreSQL URL');
  process.exit(1);
}

const isLocal = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isLocal ? undefined : { rejectUnauthorized: process.env.DB_SSL_STRICT !== 'false' },
  connectionTimeoutMillis: 8_000,
  max: 1,
});

try {
  const result = await pool.query('SELECT current_database() AS database_name, version() AS version');
  console.log(JSON.stringify({ status: 'ok', database: result.rows[0].database_name }));
} catch (error) {
  console.error(JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
