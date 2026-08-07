/**
 * Planning-Lite role — import-only, capability-scoped (rank 0).
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  // role_id is smallint. Never use gen_random_uuid().
  pgm.sql(`
    INSERT INTO security.role (role_id, role_name, description)
    VALUES (7, 'PLANNER', 'Planning-Lite: plan import only')
    ON CONFLICT (role_id) DO UPDATE
      SET role_name = EXCLUDED.role_name,
          description = EXCLUDED.description;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = async (pgm) => {
  pgm.sql(`
    DELETE FROM security.user_role
     WHERE role_id IN (SELECT role_id FROM security.role WHERE role_name = 'PLANNER');
    DELETE FROM security.role WHERE role_name = 'PLANNER';
  `);
};
