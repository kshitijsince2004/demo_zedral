const { Client } = require('pg');

async function seedSSO() {
  const client = new Client({
    connectionString: 'postgres://m1_user:m1_password@localhost:5432/m1_db'
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    // Insert Supervisor User
    await client.query(`
      INSERT INTO security.app_user(user_id, username, emp_code, full_name, auth_subject)
      VALUES 
      (3, 'jane.smith', '5566', 'Jane Smith', 'sub-3')
      ON CONFLICT (user_id) DO NOTHING;
    `);

    // Assign SUPERVISOR role
    await client.query(`
      INSERT INTO security.user_role(user_id, role_id)
      VALUES 
      (3, 2)
      ON CONFLICT DO NOTHING;
    `);
    
    // NOTE: Supervisors don't need line_access entries; they have global view (checked in useAuthStore).

    await client.query('COMMIT');
    console.log('SSO Seed data inserted successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding SSO data:', err);
  } finally {
    await client.end();
  }
}

seedSSO();
