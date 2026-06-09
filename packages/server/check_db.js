const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgres://m1_user:m1_password@localhost:5432/m1_db'
  });
  await client.connect();

  const resProcess = await client.query('SELECT * FROM master.process');
  console.log('Processes:', resProcess.rowCount);

  const resCoils = await client.query('SELECT * FROM coil.coil');
  console.log('Coils:', resCoils.rowCount);

  await client.end();
}

main().catch(console.error);
