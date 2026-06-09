exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.ppc_batch
      ADD COLUMN IF NOT EXISTS finish_thk_mm NUMERIC(6,3),
      ADD COLUMN IF NOT EXISTS active_rolling_pass_no SMALLINT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS item_no VARCHAR(20),
      ADD COLUMN IF NOT EXISTS from_work_center VARCHAR(8),
      ADD COLUMN IF NOT EXISTS to_work_center VARCHAR(8),
      ADD COLUMN IF NOT EXISTS ppc_remarks VARCHAR(200),
      ADD COLUMN IF NOT EXISTS import_remark VARCHAR(200),
      ADD COLUMN IF NOT EXISTS min_thk_tol_mm NUMERIC(6,3),
      ADD COLUMN IF NOT EXISTS max_thk_tol_mm NUMERIC(6,3),
      ADD COLUMN IF NOT EXISTS process_route_canonical VARCHAR(80),
      ADD COLUMN IF NOT EXISTS coil_count SMALLINT DEFAULT 1;

    CREATE TABLE IF NOT EXISTS planning.ppc_rolling_pass_plan (
        plan_id         BIGSERIAL PRIMARY KEY,
        batch_id        BIGINT NOT NULL REFERENCES planning.ppc_batch(batch_id) ON DELETE CASCADE,
        pass_no         SMALLINT NOT NULL CHECK (pass_no BETWEEN 1 AND 4),
        target_thk_mm   NUMERIC(6,3),
        roll_finish     VARCHAR(12),
        is_required     BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE (batch_id, pass_no)
    );

    CREATE INDEX IF NOT EXISTS ix_ppc_rolling_pass_batch ON planning.ppc_rolling_pass_plan (batch_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS planning.ppc_rolling_pass_plan;
    ALTER TABLE planning.ppc_batch
      DROP COLUMN IF EXISTS finish_thk_mm,
      DROP COLUMN IF EXISTS active_rolling_pass_no,
      DROP COLUMN IF EXISTS item_no,
      DROP COLUMN IF EXISTS from_work_center,
      DROP COLUMN IF EXISTS to_work_center,
      DROP COLUMN IF EXISTS ppc_remarks,
      DROP COLUMN IF EXISTS import_remark,
      DROP COLUMN IF EXISTS min_thk_tol_mm,
      DROP COLUMN IF EXISTS max_thk_tol_mm,
      DROP COLUMN IF EXISTS process_route_canonical,
      DROP COLUMN IF EXISTS coil_count;
  `);
};
