/** PKL order batch-keying: one pkl_order per ppc_batch (multi-batch mother coils allowed). */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.pkl_order
      ADD COLUMN IF NOT EXISTS batch_id BIGINT NULL REFERENCES planning.ppc_batch(batch_id),
      ADD COLUMN IF NOT EXISTS batch_number VARCHAR(64) NULL;

    -- Backfill from journey active step first, then PKL ppc_batch by coil.
    UPDATE txn.pkl_order po
    SET batch_id = ojs.queue_batch_id
    FROM planning.order_journey oj
    JOIN planning.order_journey_step ojs
      ON ojs.journey_id = oj.journey_id
     AND ojs.step_no = oj.current_step_no
     AND ojs.process_code = 'PKL'
    WHERE po.batch_id IS NULL
      AND oj.coil_no = po.coil_no
      AND ojs.queue_batch_id IS NOT NULL;

    UPDATE txn.pkl_order po
    SET batch_id = pb.batch_id
    FROM planning.ppc_batch pb
    WHERE po.batch_id IS NULL
      AND pb.coil_no = po.coil_no
      AND (
        pb.machine_code = 'PKL'
        OR pb.sub_process = 'PKL'
        OR pb.from_work_center IN ('P', 'PKL')
      );

    UPDATE txn.pkl_order po
    SET batch_number = pb.batch_number
    FROM planning.ppc_batch pb
    WHERE po.batch_number IS NULL
      AND po.batch_id = pb.batch_id;

    -- Move identity off coil_no.
    ALTER TABLE txn.pkl_order
      DROP CONSTRAINT IF EXISTS pkl_order_coil_no_key;

    CREATE UNIQUE INDEX IF NOT EXISTS ux_pkl_order_batch_id
      ON txn.pkl_order (batch_id)
      WHERE batch_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS ix_pkl_order_coil_no
      ON txn.pkl_order (coil_no);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.ux_pkl_order_batch_id;
    DROP INDEX IF EXISTS txn.ix_pkl_order_coil_no;
    ALTER TABLE txn.pkl_order DROP COLUMN IF EXISTS batch_number;
    ALTER TABLE txn.pkl_order DROP COLUMN IF EXISTS batch_id;
    ALTER TABLE txn.pkl_order
      ADD CONSTRAINT pkl_order_coil_no_key UNIQUE (coil_no);
  `);
};
