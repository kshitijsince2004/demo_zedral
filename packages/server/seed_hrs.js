const { Client } = require('pg');

async function seedHRS() {
  const client = new Client({
    connectionString: 'postgres://m1_user:m1_password@localhost:5432/m1_db'
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    // Insert Coils for HRS (Process 1)
    await client.query(`
      INSERT INTO coil.coil(coil_no, customer_id, grade_code, nominal_width_mm, coil_thk_mm, weight_mt, current_process_id, next_dest, status)
      VALUES 
      ('HRS-COIL-1', 1, 'CRCA', 1250, 4.0, 25.0, 1, 'PKL', 'PLANNED'),
      ('HRS-COIL-2', 2, 'D513', 1500, 3.5, 28.0, 1, 'PKL', 'PLANNED')
      ON CONFLICT (coil_no) DO NOTHING;
    `);

    // Insert Plan Orders if missing
    await client.query(`
      INSERT INTO planning.plan_order(plan_order_id, sap_order_no, customer_id, grade_code, planned_qty_mt)
      VALUES 
      (3, 'SAP-HRS-01', 1, 'CRCA', 50.0)
      ON CONFLICT (sap_order_no) DO NOTHING;
    `);

    // Insert Coil Plan for HRS (Process 1)
    await client.query(`
      INSERT INTO planning.coil_plan(plan_order_id, coil_no, planned_process_id, seq_no)
      VALUES 
      (3, 'HRS-COIL-1', 1, 1),
      (3, 'HRS-COIL-2', 1, 2)
      ON CONFLICT DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('HRS Seed data inserted successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding HRS data:', err);
  } finally {
    await client.end();
  }
}

seedHRS();
