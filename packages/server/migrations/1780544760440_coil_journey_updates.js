exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Add Oxygen Percentage to txn.ann_charge
    ALTER TABLE txn.ann_charge ADD COLUMN IF NOT EXISTS oxygen_pct NUMERIC(5,2);

    -- 2. Add SOP bounds to master.grade for Pickling Validations
    ALTER TABLE master.grade ADD COLUMN IF NOT EXISTS pkl_speed_min NUMERIC(6,2);
    ALTER TABLE master.grade ADD COLUMN IF NOT EXISTS pkl_speed_max NUMERIC(6,2);
    ALTER TABLE master.grade ADD COLUMN IF NOT EXISTS acid_pct_min NUMERIC(5,2);
    ALTER TABLE master.grade ADD COLUMN IF NOT EXISTS acid_pct_max NUMERIC(5,2);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.ann_charge DROP COLUMN IF EXISTS oxygen_pct;
    ALTER TABLE master.grade DROP COLUMN IF EXISTS pkl_speed_min;
    ALTER TABLE master.grade DROP COLUMN IF EXISTS pkl_speed_max;
    ALTER TABLE master.grade DROP COLUMN IF EXISTS acid_pct_min;
    ALTER TABLE master.grade DROP COLUMN IF EXISTS acid_pct_max;
  `);
};
