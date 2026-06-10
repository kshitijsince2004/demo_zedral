/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- Update handover_priority check and default
    ALTER TABLE txn.machine_handover DROP CONSTRAINT IF EXISTS machine_handover_priority_check;
    
    ALTER TABLE txn.machine_handover 
      ALTER COLUMN handover_priority SET DEFAULT 'MEDIUM';

    ALTER TABLE txn.machine_handover
      ADD CONSTRAINT machine_handover_priority_check
      CHECK (handover_priority::text = ANY (ARRAY[
        'LOW'::text,
        'MEDIUM'::text,
        'HIGH'::text
      ]));

    -- Update status check to include REJECTED
    ALTER TABLE txn.machine_handover DROP CONSTRAINT IF EXISTS machine_handover_status_check;

    ALTER TABLE txn.machine_handover
      ADD CONSTRAINT machine_handover_status_check
      CHECK (status::text = ANY (ARRAY[
        'DRAFT'::text,
        'PENDING'::text,
        'ACCEPTED'::text,
        'REJECTED'::text,
        'CLARIFICATION_REQUESTED'::text,
        'CANCELLED'::text
      ]));
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.machine_handover DROP CONSTRAINT IF EXISTS machine_handover_priority_check;
    
    ALTER TABLE txn.machine_handover 
      ALTER COLUMN handover_priority SET DEFAULT 'NORMAL';

    ALTER TABLE txn.machine_handover
      ADD CONSTRAINT machine_handover_priority_check
      CHECK (handover_priority::text = ANY (ARRAY[
        'LOW'::text,
        'NORMAL'::text,
        'HIGH'::text,
        'CRITICAL'::text
      ]));

    ALTER TABLE txn.machine_handover DROP CONSTRAINT IF EXISTS machine_handover_status_check;

    ALTER TABLE txn.machine_handover
      ADD CONSTRAINT machine_handover_status_check
      CHECK (status::text = ANY (ARRAY[
        'DRAFT'::text,
        'PENDING'::text,
        'ACCEPTED'::text,
        'CLARIFICATION_REQUESTED'::text,
        'CANCELLED'::text
      ]));
  `);
};
