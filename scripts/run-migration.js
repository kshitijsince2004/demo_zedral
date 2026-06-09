const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ connectionString: 'postgres://m1_user:m1_password@localhost:5432/m1_db' });

const sql = fs.readFileSync('packages/server/migrations/20260609_consolidated_enhancements.sql', 'utf8');

pool.query(sql)
  .then(() => {
    console.log('Migration OK');
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
