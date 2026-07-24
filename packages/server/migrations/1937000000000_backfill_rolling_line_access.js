/**
 * After process 31 was renamed 6HI -> ROLLING, MachineAccessService still derived
 * line_access as process code '6HI', which failed resolveProcessId and left CRM
 * users with machines but empty line_access (403 on /shift-logs/active/ROLLING).
 * Backfill ROLLING WRITE for anyone with CRM mill access and no ROLLING line row.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO security.line_access (user_id, process_id, access_level)
    SELECT DISTINCT ma.user_id, p.process_id, 'WRITE'
    FROM security.machine_access ma
    CROSS JOIN master.process p
    WHERE ma.machine_code IN ('6HI', '4HI', '2HI')
      AND p.code = 'ROLLING'
      AND NOT EXISTS (
        SELECT 1
        FROM security.line_access la
        WHERE la.user_id = ma.user_id
          AND la.process_id = p.process_id
      );
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = () => {
  // Keep backfilled rows - removing them would re-break assigned CRM users.
};
