/**
 * P4 / E2 — drop dead security.permission (no inbound FKs; authzService removed).
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = async (pgm) => {
  await pgm.db.query(`
    DO $$ BEGIN
      IF to_regclass('security.permission') IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE contype = 'f'
            AND confrelid = 'security.permission'::regclass
        ) THEN
          RAISE EXCEPTION 'security.permission still has inbound FK references';
        ELSE
          DROP TABLE security.permission;
        END IF;
      END IF;
    END $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS security.permission (
      permission_id BIGSERIAL PRIMARY KEY,
      tenant_id UUID NOT NULL,
      role VARCHAR(50) NOT NULL,
      resource VARCHAR(100) NOT NULL,
      action VARCHAR(50) NOT NULL
    );
  `);
};
