import { Client } from 'pg';

const connectionString = process.env.BIS_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('BIS_DATABASE_URL or DATABASE_URL is required');
const client = new Client({ connectionString });
try {
  await client.connect();
  const result = await client.query('SELECT current_user AS role, current_database() AS database');
  process.stdout.write(`PostgreSQL connection verified for ${result.rows[0].role} on ${result.rows[0].database}\n`);
} finally {
  await client.end().catch(() => undefined);
}
