const { Client } = require('pg');

async function check() {
  const client = new Client({
    connectionString: 'postgres://m1_user:m1_password@localhost:5432/m1_db'
  });
  await client.connect();

  const res = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'security' AND table_name = 'role';
  `);
  console.log(res.rows);

  await client.end();
}
check().catch(console.error);
