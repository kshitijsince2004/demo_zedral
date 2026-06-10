import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgres://m1_user:m1_pass123@localhost:5432/m1_db' });
await client.connect();
const res = await client.query("SELECT shift_log_id, prod_date, shift_code, process_id FROM txn.shift_log ORDER BY created_at DESC LIMIT 5");
console.log(res.rows);
await client.end();
