/** Machine classification for stoppage codes (mirrors defect_code.applies_to). */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.stoppage_code
      ADD COLUMN IF NOT EXISTS applies_to text;

    -- Backfill from code prefix so existing PKL/HRS/… catalogues keep working
    -- without hardcoded LIKE filters in station APIs.
    UPDATE master.stoppage_code SET applies_to = 'PKL'
      WHERE applies_to IS NULL AND stoppage_code ILIKE 'PKL-%';
    UPDATE master.stoppage_code SET applies_to = 'HRS'
      WHERE applies_to IS NULL AND stoppage_code ILIKE 'HRS-%';
    UPDATE master.stoppage_code SET applies_to = 'ANN'
      WHERE applies_to IS NULL AND stoppage_code ILIKE 'ANN-%';
    UPDATE master.stoppage_code SET applies_to = 'RWD'
      WHERE applies_to IS NULL AND stoppage_code ILIKE 'RWD-%';
    UPDATE master.stoppage_code SET applies_to = 'CRS'
      WHERE applies_to IS NULL AND stoppage_code ILIKE 'CRS-%';
    UPDATE master.stoppage_code SET applies_to = 'CTL'
      WHERE applies_to IS NULL AND stoppage_code ILIKE 'CTL-%';
    UPDATE master.stoppage_code SET applies_to = 'SKP'
      WHERE applies_to IS NULL AND stoppage_code ILIKE 'SKP-%';

    -- Numeric / unprefixed CRM catalogue → rolling line
    UPDATE master.stoppage_code SET applies_to = 'CRM6'
      WHERE applies_to IS NULL
        AND stoppage_code ~ '^[0-9]{1,2}$';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.stoppage_code DROP COLUMN IF EXISTS applies_to;
  `);
};
