const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgres://m1_user:m1_password@localhost:5432/m1_db'
  });
  await client.connect();

  console.log("=== Tables ===");
  const tables = await client.query(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name;
  `);
  console.log(JSON.stringify(tables.rows, null, 2));

  console.log("\n=== Users ===");
  const users = await client.query("SELECT * FROM security.app_user LIMIT 10;");
  console.log(JSON.stringify(users.rows, null, 2));

  console.log("\n=== Shifts ===");
  const shifts = await client.query("SELECT * FROM master.shift;");
  console.log(JSON.stringify(shifts.rows, null, 2));

  await client.end();
}

main().catch(console.error);
