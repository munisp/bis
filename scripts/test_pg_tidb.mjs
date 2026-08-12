import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL;
const m = url?.match(/mysql:\/\/([^:]+):([^@]+)@([^/]+)\/([^?]+)/);
if (!m) { console.log('No match'); process.exit(1); }
const [,user,pass,hostport,db] = m;

// TiDB Serverless PostgreSQL endpoint is on port 4000 (same as MySQL)
const pgUrl = `postgresql://${user}:${pass}@${hostport}/${db}`;
console.log('Trying:', pgUrl.substring(0, 60));

const pool = new Pool({ 
  connectionString: pgUrl, 
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000 
});

try {
  const r = await pool.query('SELECT 1 as ok');
  console.log('PG OK:', r.rows[0]);
} catch (e) {
  console.log('PG ERR:', e.message);
} finally {
  await pool.end();
}
