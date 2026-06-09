/**
 * Schema-only: REJECTED order status, order_rejection table, order_remark.defect_codes.
 * Master data (defect/stoppage codes) is not seeded here — load via app import or admin.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.stoppage_code DROP CONSTRAINT IF EXISTS stoppage_code_category_check;
    ALTER TABLE master.stoppage_code ADD CONSTRAINT stoppage_code_category_check
      CHECK (category IN ('OPN', 'ELECT', 'MECH', 'UTILITY', 'POWER', 'PLANNED', 'OTHER',
                          'MECHANICAL', 'ELECTRICAL', 'CRANE', 'OPERATIONAL', 'MATERIAL',
                          'SERVICES', 'MAINTENANCE', 'MANPOWER', 'HYDRAULIC', 'PLANNING'));

    ALTER TABLE txn.crm6_order DROP CONSTRAINT IF EXISTS crm6_order_status_check;
    ALTER TABLE txn.crm6_order ADD CONSTRAINT crm6_order_status_check
      CHECK (status IN ('PENDING','PREPARING','IN_PROGRESS','STOPPAGE','COMPLETED','REJECTED'));

    CREATE TABLE IF NOT EXISTS txn.order_rejection (
      rejection_id    BIGSERIAL PRIMARY KEY,
      order_id        BIGINT NOT NULL REFERENCES txn.crm6_order(order_id) ON DELETE CASCADE,
      rejection_reason VARCHAR(100) NOT NULL,
      defect_codes    JSONB,
      remarks         TEXT NOT NULL,
      operator_id     INTEGER NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tenant_id       VARCHAR(50) NOT NULL DEFAULT current_setting('app.tenant_id', true)
    );

    CREATE INDEX IF NOT EXISTS idx_order_rejection_order ON txn.order_rejection(order_id);

    ALTER TABLE txn.order_remark
      ADD COLUMN IF NOT EXISTS defect_codes JSONB;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.order_remark DROP COLUMN IF EXISTS defect_codes;
    DROP TABLE IF EXISTS txn.order_rejection;
    ALTER TABLE txn.crm6_order DROP CONSTRAINT IF EXISTS crm6_order_status_check;
    ALTER TABLE txn.crm6_order ADD CONSTRAINT crm6_order_status_check
      CHECK (status IN ('PENDING','PREPARING','IN_PROGRESS','STOPPAGE','COMPLETED'));
  `);
};
