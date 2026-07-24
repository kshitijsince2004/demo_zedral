const { Client } = require('pg');

async function seedDemoState() {
  const client = new Client({
    connectionString: 'postgres://m1_user:m1_password@localhost:5432/m1_db'
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Ensure John Doe exists and is assigned to HRS (process_id = 1)
    await client.query(`
      INSERT INTO security.line_access(user_id, process_id)
      VALUES (1, 1) ON CONFLICT DO NOTHING;
    `);

    // 2. Create an ACTIVE Shift Log for John Doe (user_id = 1) on HRS
    // Plant calendar today (IST), not UTC.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    
    // Check if there is already an active shift log, if so delete it so we can create a clean one
    await client.query(`
      DELETE FROM txn.shift_log WHERE process_id = 1 AND prod_date = $1 AND shift_code = 'A';
    `, [today]);

    // Re-insert
    const res = await client.query(`
      INSERT INTO txn.shift_log(process_id, prod_date, shift_code, target_mt, state)
      VALUES (1, $1, 'A', 150.0, 'DRAFT')
      RETURNING shift_log_id;
    `, [today]);
    const shiftLogId = res.rows[0].shift_log_id;

    // 3. Mark a coil as IN_PROCESS for HRS
    await client.query(`
      UPDATE coil.coil 
      SET status = 'IN_PROCESS' 
      WHERE coil_no = 'HRS-COIL-1';
    `);

    // 4. Add an ongoing Stoppage (Crane issue)
    
    // Make sure we have a stoppage code
    await client.query(`
      INSERT INTO master.stoppage_code(stoppage_code, description, category)
      VALUES ('ME-01', 'Crane Unavailability', 'MECH')
      ON CONFLICT (stoppage_code) DO NOTHING;
    `);

    await client.query(`
      ALTER TABLE txn.stoppage_entry ALTER COLUMN time_to DROP NOT NULL;
    `);

    await client.query(`
      INSERT INTO txn.stoppage_entry(shift_log_id, stoppage_code, time_from, time_to, remarks)
      VALUES ($1, 'ME-01', '12:00:00', NULL, 'Waiting for crane to move previous coils');
    `, [shiftLogId]);

    // 5. Add some Production Data to show "Produced" in Handover
    // HRS produces child coils (HRS-COIL-X-A, etc.)
    const prodRes = await client.query(`
      INSERT INTO txn.prod_hrs(shift_log_id, coil_no, scrap_mt, time_from, time_to)
      VALUES ($1, 'HRS-COIL-2', 0.5, '10:00:00', '11:00:00')
      RETURNING entry_id;
    `, [shiftLogId]);
    
    const entryId = prodRes.rows[0].entry_id;
    
    // Insert slit coils (to add weight to the shift)
    // Need to also insert them into coil.coil first since they have foreign keys!
    await client.query(`
      INSERT INTO coil.coil(coil_no, customer_id, grade_code, nominal_width_mm, coil_thk_mm, weight_mt, current_process_id, next_dest, status)
      VALUES 
      ('HRS-COIL-2-A', 2, 'D513', 500, 3.5, 10.0, 1, 'PKL', 'PLANNED'),
      ('HRS-COIL-2-B', 2, 'D513', 500, 3.5, 15.0, 1, 'PKL', 'PLANNED')
      ON CONFLICT DO NOTHING;
    `);

    await client.query(`
      INSERT INTO txn.prod_hrs_slit(entry_id, slot, child_coil_no, width_mm)
      VALUES 
      ($1, 'A', 'HRS-COIL-2-A', 500),
      ($1, 'B', 'HRS-COIL-2-B', 500);
    `, [entryId]);

    // Update the parent coil to DONE
    await client.query(`
      UPDATE coil.coil 
      SET status = 'DONE' 
      WHERE coil_no = 'HRS-COIL-2';
    `);

    await client.query('COMMIT');
    console.log('Demo state inserted successfully!');
    console.log('Shift Log ID:', shiftLogId);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding demo state:', err);
  } finally {
    await client.end();
  }
}

seedDemoState();
