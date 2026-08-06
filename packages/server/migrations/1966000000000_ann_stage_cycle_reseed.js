/** ANN 10-stage cycle master (plan §4.3 / §5.8). Idempotent upsert on stage_code. */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.ann_stage
      ADD COLUMN IF NOT EXISTS default_active BOOLEAN NOT NULL DEFAULT true;

    INSERT INTO master.ann_stage (stage_code, seq, label, is_skippable, default_active, is_active) VALUES
      ('LOADING', 1, 'Loading', false, true, true),
      ('PURGING', 2, 'Purging', false, true, true),
      ('HEATING', 3, 'Heating', false, true, true),
      ('SOAKING', 4, 'Soaking', false, true, true),
      ('FURNACE_COOL', 5, 'Furnace Cool', false, true, true),
      ('NATURAL_COOL', 6, 'Natural Cool', false, true, true),
      ('RAPID_COOL', 7, 'Rapid Cool', true, true, true),
      ('WATER_COOL', 8, 'Water Cool', true, true, true),
      ('POST_PURGING', 9, 'Post Purging', false, true, true),
      ('UNLOADING', 10, 'Unloading', false, true, true)
    ON CONFLICT (stage_code) DO UPDATE SET
      seq = EXCLUDED.seq,
      label = EXCLUDED.label,
      is_skippable = EXCLUDED.is_skippable,
      default_active = EXCLUDED.default_active,
      is_active = true;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE master.ann_stage DROP COLUMN IF EXISTS default_active;`);
};
