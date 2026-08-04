/** Drop unused audit.lineage_ref (no runtime consumer). Keep ann_cooling_hood — FK on ann_charge. */
exports.up = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS audit.lineage_ref;`);
};

exports.down = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS audit.lineage_ref (
      lineage_id BIGSERIAL PRIMARY KEY
    );
  `);
};
