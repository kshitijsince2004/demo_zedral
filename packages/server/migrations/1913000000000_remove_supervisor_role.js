exports.up = async (pgm) => {
  pgm.sql(`
    -- 1. Convert their line_access -> machine_access FIRST while they still have the role_id of SUPERVISOR
    INSERT INTO security.machine_access (user_id, machine_code)
    SELECT DISTINCT la.user_id, m.machine_code
      FROM security.line_access la
      JOIN master.machine m ON m.process_id = la.process_id
     WHERE la.user_id IN (
       SELECT user_id FROM security.user_role
        WHERE role_id = (SELECT role_id FROM security.role WHERE role_name='SUPERVISOR')
     )
    ON CONFLICT DO NOTHING;

    -- 2. Re-point every SUPERVISOR user to MACHINE_HEAD
    UPDATE security.user_role
       SET role_id = (SELECT role_id FROM security.role WHERE role_name='MACHINE_HEAD')
     WHERE role_id = (SELECT role_id FROM security.role WHERE role_name='SUPERVISOR');

    -- 3. Remove the SUPERVISOR role row
    DELETE FROM security.role WHERE role_name='SUPERVISOR';

    -- 4. Rename the override reason code
    UPDATE txn.shift_override_audit
       SET reason_code = 'MACHINE_HEAD_INSTRUCTION'
     WHERE reason_code = 'SUPERVISOR_INSTRUCTION';

    ALTER TABLE txn.shift_override_audit DROP CONSTRAINT IF EXISTS shift_override_audit_reason_code_check;
    ALTER TABLE txn.shift_override_audit ADD CONSTRAINT shift_override_audit_reason_code_check
      CHECK (reason_code IN ('OVERTIME','PREV_SHIFT_CONTINUATION','MACHINE_HEAD_INSTRUCTION','SHIFT_CORRECTION','OTHER'));
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    INSERT INTO security.role (role_id, role_name, description)
    VALUES (2, 'SUPERVISOR', 'Line Supervisor')
    ON CONFLICT DO NOTHING;

    UPDATE txn.shift_override_audit
       SET reason_code = 'SUPERVISOR_INSTRUCTION'
     WHERE reason_code = 'MACHINE_HEAD_INSTRUCTION';

    ALTER TABLE txn.shift_override_audit DROP CONSTRAINT IF EXISTS shift_override_audit_reason_code_check;
    ALTER TABLE txn.shift_override_audit ADD CONSTRAINT shift_override_audit_reason_code_check
      CHECK (reason_code IN ('OVERTIME','PREV_SHIFT_CONTINUATION','SUPERVISOR_INSTRUCTION','SHIFT_CORRECTION','OTHER'));
  `);
};
