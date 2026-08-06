/**
 * First-class combined batch list for Manual Re-Roll sessions.
 * Backfills from remarks [[batches:…]] tag or single batch_number.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.manual_reroll_session
      ADD COLUMN IF NOT EXISTS batch_numbers TEXT[];

    UPDATE txn.manual_reroll_session
    SET batch_numbers = CASE
      WHEN remarks ~ '\\[\\[batches:[^\\]]+\\]\\]' THEN
        string_to_array(
          regexp_replace(remarks, '^.*\\[\\[batches:([^\\]]+)\\]\\].*$', '\\1'),
          ','
        )
      WHEN batch_number IS NOT NULL AND btrim(batch_number) <> '' THEN
        ARRAY[btrim(batch_number)]
      ELSE NULL
    END
    WHERE batch_numbers IS NULL;

    -- Strip legacy combine tags from free-text remarks
    UPDATE txn.manual_reroll_session
    SET remarks = NULLIF(btrim(regexp_replace(remarks, '\\[\\[batches:[^\\]]+\\]\\]\\n?', '', 'g')), '')
    WHERE remarks ~ '\\[\\[batches:';

    COMMENT ON COLUMN txn.manual_reroll_session.batch_numbers IS
      'Combined re-roll batch list (overlay). Null/single = primary batch_number only.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.manual_reroll_session DROP COLUMN IF EXISTS batch_numbers;
  `);
};
