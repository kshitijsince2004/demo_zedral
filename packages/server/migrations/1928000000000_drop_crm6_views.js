/**
 * P3 / E1 — drop transitional txn.crm6_* views (tables already renamed to crm_*).
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    DROP VIEW IF EXISTS txn.crm6_order;
    DROP VIEW IF EXISTS txn.crm6_rolling;
    DROP VIEW IF EXISTS txn.crm6_rolling_pass;
    DROP VIEW IF EXISTS txn.crm6_skinpass;
    DROP VIEW IF EXISTS txn.crm6_shift_summary;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    CREATE VIEW txn.crm6_order         AS SELECT * FROM txn.crm_order;
    CREATE VIEW txn.crm6_rolling       AS SELECT * FROM txn.crm_rolling;
    CREATE VIEW txn.crm6_rolling_pass  AS SELECT * FROM txn.crm_rolling_pass;
    CREATE VIEW txn.crm6_skinpass      AS SELECT * FROM txn.crm_skinpass;
    CREATE VIEW txn.crm6_shift_summary AS SELECT * FROM txn.crm_shift_summary;
  `);
};
