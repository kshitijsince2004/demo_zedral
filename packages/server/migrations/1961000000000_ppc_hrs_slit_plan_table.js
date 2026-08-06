/** HRS import plan-slit capture table (one mother-coil batch, many slits). */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS planning.ppc_hrs_slit (
      slit_pk BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES planning.ppc_batch(batch_id) ON DELETE CASCADE,
      slit_no SMALLINT NOT NULL,
      slit_label VARCHAR(8) NOT NULL,
      width_mm NUMERIC NOT NULL,
      weight_mt NUMERIC NULL,
      finish_thk_mm NUMERIC NULL,
      process_route_raw VARCHAR(60) NULL,
      sap_order_no VARCHAR(30) NULL,
      item_no VARCHAR(20) NULL,
      customer_name VARCHAR(120) NULL,
      child_coil_no VARCHAR(30) NULL,
      downstream_batch_number VARCHAR(30) NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_ppc_hrs_slit_batch_no
      ON planning.ppc_hrs_slit (batch_id, slit_no);

    CREATE INDEX IF NOT EXISTS ix_ppc_hrs_slit_child
      ON planning.ppc_hrs_slit (child_coil_no);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS planning.ix_ppc_hrs_slit_child;
    DROP INDEX IF EXISTS planning.ux_ppc_hrs_slit_batch_no;
    DROP TABLE IF EXISTS planning.ppc_hrs_slit;
  `);
};
