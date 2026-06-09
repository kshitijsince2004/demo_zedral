const { Client } = require('pg');

async function seed() {
  const client = new Client({
    connectionString: 'postgres://m1_user:m1_password@localhost:5432/m1_db'
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Insert Customer
    await client.query(`
      INSERT INTO master.customer(customer_code, customer_name)
      VALUES ('CUST-001', 'Tata Motors'), ('CUST-002', 'Maruti Suzuki')
      ON CONFLICT (customer_code) DO NOTHING;
    `);

    // 2. Insert Grade
    await client.query(`
      INSERT INTO master.grade(grade_code, description, grade_family)
      VALUES ('CRCA', 'Cold Rolled Close Annealed', 'CRCA'), ('D513', 'Deep Drawing', 'DRAW')
      ON CONFLICT (grade_code) DO NOTHING;
    `);

    // 2b. Insert Process 9 (GLV) if missing
    await client.query(`
      INSERT INTO master.process(process_id, code, name, seq_no, has_mill_type)
      VALUES (9, 'GLV', 'Galvanizing Line', 9, FALSE)
      ON CONFLICT (process_id) DO NOTHING;
    `);

    // 3. Insert Users (John Doe & Sarah Connor)
    await client.query(`
      INSERT INTO security.app_user(user_id, username, emp_code, full_name, auth_subject)
      VALUES 
      (1, 'john.doe', '3344', 'John Doe', 'sub-1'),
      (2, 'sarah.connor', '4321', 'Sarah Connor', 'sub-2')
      ON CONFLICT (user_id) DO NOTHING;
    `);

    // 4. Insert Roles if not present (handled by migration, but just in case)
    // The previous migration already inserted OPERATOR role but didn't assign it.
    await client.query(`
      INSERT INTO security.user_role(user_id, role_id)
      VALUES 
      (1, 1), (2, 1)
      ON CONFLICT DO NOTHING;
    `);

    // 5. Insert Coils
    // Note: status is constrained to: ('PLANNED','IN_PROCESS','HOLD','REWORK','DONE','SCRAPPED')
    await client.query(`
      INSERT INTO coil.coil(coil_no, customer_id, grade_code, nominal_width_mm, coil_thk_mm, weight_mt, current_process_id, next_dest, status)
      VALUES 
      ('COIL-100', 1, 'CRCA', 1250, 2.5, 12.4, 3, 'CRM', 'PLANNED'),
      ('COIL-200', 1, 'CRCA', 1250, 2.5, 15.1, 3, 'CRM', 'PLANNED'),
      ('COIL-300', 2, 'D513', 1000, 1.2, 8.5, 8, 'CTL', 'PLANNED'),
      ('COIL-400', 2, 'D513', 1000, 1.2, 9.2, 8, 'CTL', 'PLANNED'),
      ('COIL-500', 1, 'CRCA', 1250, 2.5, 11.5, 3, 'CRM', 'IN_PROCESS'),
      ('GLV-100', 1, 'CRCA', 1200, 1.0, 10.0, 9, 'GLV', 'PLANNED')
      ON CONFLICT (coil_no) DO NOTHING;
    `);

    // 6. Insert Plan Orders and Coil Plans
    await client.query(`
      INSERT INTO planning.plan_order(plan_order_id, sap_order_no, customer_id, grade_code, planned_qty_mt)
      VALUES 
      (1, 'SAP-10001', 1, 'CRCA', 50.0),
      (2, 'SAP-10002', 2, 'D513', 25.0)
      ON CONFLICT (sap_order_no) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO planning.coil_plan(plan_order_id, coil_no, planned_process_id, seq_no)
      VALUES 
      (1, 'COIL-100', 3, 1),
      (1, 'COIL-200', 3, 2),
      (1, 'COIL-500', 3, 3),
      (2, 'COIL-300', 8, 1),
      (2, 'COIL-400', 8, 2),
      (1, 'GLV-100', 9, 1)
      ON CONFLICT DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('Seed data inserted successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding data:', err);
  } finally {
    await client.end();
  }
}

seed();
