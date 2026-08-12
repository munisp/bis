import pg from 'pg';
const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
try {
  const res = await pool.query('SELECT id FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 3');
  console.log('Last migrations:', res.rows);
  const cols = await pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('investigations','screening_orders') AND column_name IN ('candidateProfileId','investigationRef')");
  console.log('New columns present:', cols.rows);
} catch(e) {
  console.error(e.message);
} finally {
  await pool.end();
}
