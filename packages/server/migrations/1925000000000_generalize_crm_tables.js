exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.crm6_order         RENAME TO crm_order;
    ALTER TABLE txn.crm6_rolling       RENAME TO crm_rolling;
    ALTER TABLE txn.crm6_rolling_pass  RENAME TO crm_rolling_pass;
    ALTER TABLE txn.crm6_skinpass      RENAME TO crm_skinpass;
    ALTER TABLE txn.crm6_shift_summary RENAME TO crm_shift_summary;

    -- transitional 1:1 updatable views (auto-updatable in Postgres); drop in a later contract migration
    CREATE VIEW txn.crm6_order         AS SELECT * FROM txn.crm_order;
    CREATE VIEW txn.crm6_rolling       AS SELECT * FROM txn.crm_rolling;
    CREATE VIEW txn.crm6_rolling_pass  AS SELECT * FROM txn.crm_rolling_pass;
    CREATE VIEW txn.crm6_skinpass      AS SELECT * FROM txn.crm_skinpass;
    CREATE VIEW txn.crm6_shift_summary AS SELECT * FROM txn.crm_shift_summary;
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    DROP VIEW IF EXISTS txn.crm6_order, txn.crm6_rolling, txn.crm6_rolling_pass,
                        txn.crm6_skinpass, txn.crm6_shift_summary;
    ALTER TABLE txn.crm_order         RENAME TO crm6_order;
    ALTER TABLE txn.crm_rolling       RENAME TO crm6_rolling;
    ALTER TABLE txn.crm_rolling_pass  RENAME TO crm6_rolling_pass;
    ALTER TABLE txn.crm_skinpass      RENAME TO crm6_skinpass;
    ALTER TABLE txn.crm_shift_summary RENAME TO crm6_shift_summary;
  `);
};
