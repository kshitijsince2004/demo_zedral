exports.up = (pgm) => {
  pgm.sql(`
    -- Add GLV process
    INSERT INTO master.process (process_id, code, name, seq_no, has_mill_type)
    VALUES (9, 'GLV', 'Galvanizing Line', 90, FALSE)
    ON CONFLICT (process_id) DO NOTHING;

    -- Create GLV production table
    CREATE TABLE txn.prod_glv (
        entry_id        BIGSERIAL    PRIMARY KEY,
        shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
        sl_no           SMALLINT     NOT NULL,
        coil_no         VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
        zinc_coating_gsm NUMERIC(5,2),
        spangle_type    VARCHAR(20),
        weight_mt       NUMERIC(9,3) NOT NULL,
        remarks         VARCHAR(250),
        time_from       TIMESTAMP,
        time_to         TIMESTAMP,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS txn.prod_glv;
    DELETE FROM master.process WHERE code = 'GLV';
  `);
};
