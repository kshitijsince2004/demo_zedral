/** Allow XLSX as import_batch.source for PPC rolling plan uploads. */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.import_batch
      DROP CONSTRAINT IF EXISTS import_batch_source_check;

    ALTER TABLE planning.import_batch
      ADD CONSTRAINT import_batch_source_check
      CHECK (source IN ('CSV', 'SAP', 'MANUAL', 'XLSX'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE planning.import_batch SET source = 'CSV' WHERE source = 'XLSX';

    ALTER TABLE planning.import_batch
      DROP CONSTRAINT IF EXISTS import_batch_source_check;

    ALTER TABLE planning.import_batch
      ADD CONSTRAINT import_batch_source_check
      CHECK (source IN ('CSV', 'SAP', 'MANUAL'));
  `);
};
