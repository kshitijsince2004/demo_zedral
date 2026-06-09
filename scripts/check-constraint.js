const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://m1_user:m1_password@localhost:5432/m1_db' });

pool.query(`SELECT pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conname = 'stoppage_code_category_check'`)
  .then(res => {
    console.log('Constraint Definition:');
    console.log(res.rows[0]?.def);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
