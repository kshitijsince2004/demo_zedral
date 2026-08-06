/** Allow txn.ann_charge.status = PREPARING (unassigned-base hold). */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'txn.ann_charge'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
      LOOP
        EXECUTE format('ALTER TABLE txn.ann_charge DROP CONSTRAINT %I', r.conname);
      END LOOP;
    END $$;

    ALTER TABLE txn.ann_charge
      ADD CONSTRAINT ann_charge_status_check
      CHECK (status IN ('PREPARING','IN_PROCESS','FOR_ANN','RW','DONE'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE txn.ann_charge SET status = 'IN_PROCESS' WHERE status = 'PREPARING';
    ALTER TABLE txn.ann_charge DROP CONSTRAINT IF EXISTS ann_charge_status_check;
    ALTER TABLE txn.ann_charge
      ADD CONSTRAINT ann_charge_status_check
      CHECK (status IN ('IN_PROCESS','FOR_ANN','RW','DONE'));
  `);
};
