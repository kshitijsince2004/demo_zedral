exports.up = async (pgm) => {
  // role_id is smallint (legacy SUPERVISOR used 2). Never use gen_random_uuid().
  pgm.sql(`
    INSERT INTO security.role (role_id, role_name, description)
    VALUES (2, 'SUPERVISOR', 'Oversight: live dashboards, import, traceability, assignment')
    ON CONFLICT (role_id) DO UPDATE
      SET role_name = EXCLUDED.role_name,
          description = EXCLUDED.description;
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DELETE FROM security.user_role
     WHERE role_id IN (SELECT role_id FROM security.role WHERE role_name = 'SUPERVISOR');
    DELETE FROM security.role WHERE role_name = 'SUPERVISOR';
  `);
};