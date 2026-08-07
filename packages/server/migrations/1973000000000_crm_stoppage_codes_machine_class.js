/**
 * Put CRM rolling-line stoppages into master.stoppage_code with applies_to=CRM6
 * so Admin Machine Classification + /stations/stoppage-codes?machine= drive 6HI/4HI/2HI.
 * Also backfill any leftover NULL applies_to from code prefix.
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO master.stoppage_code (stoppage_code, description, category, is_planned, is_active, applies_to)
    VALUES
      ('01', 'Mechanical', 'MECH', false, true, 'CRM6'),
      ('02', 'Electrical', 'ELECT', false, true, 'CRM6'),
      ('03', 'Crane', 'OPN', false, true, 'CRM6'),
      ('04', 'Work Roll Change', 'OPN', false, true, 'CRM6'),
      ('05', 'H.V.L.V.', 'ELECT', false, true, 'CRM6'),
      ('06', 'Backup Roll Change', 'OPN', false, true, 'CRM6'),
      ('07', 'Raw Material', 'OPN', true, true, 'CRM6'),
      ('08', 'Services', 'OPN', false, true, 'CRM6'),
      ('09', 'Preventive Maintenance', 'MECH', true, true, 'CRM6'),
      ('10', 'Short of Man', 'OPN', true, true, 'CRM6'),
      ('11', 'Power Failure', 'ELECT', false, true, 'CRM6'),
      ('12', 'Operational', 'OPN', false, true, 'CRM6'),
      ('13', 'No Planning', 'OPN', true, true, 'CRM6'),
      ('14', 'Hydraulic', 'MECH', false, true, 'CRM6'),
      ('15', 'Material Short Due to Crane Breakdown', 'OPN', false, true, 'CRM6'),
      ('16', 'Setting Adjustment', 'OPN', false, true, 'CRM6')
    ON CONFLICT (stoppage_code) DO UPDATE SET
      description = COALESCE(EXCLUDED.description, master.stoppage_code.description),
      applies_to = COALESCE(NULLIF(TRIM(master.stoppage_code.applies_to), ''), EXCLUDED.applies_to),
      is_active = true;

    UPDATE master.stoppage_code SET applies_to = 'PKL'
      WHERE (applies_to IS NULL OR TRIM(applies_to) = '') AND stoppage_code ILIKE 'PKL-%';
    UPDATE master.stoppage_code SET applies_to = 'HRS'
      WHERE (applies_to IS NULL OR TRIM(applies_to) = '') AND stoppage_code ILIKE 'HRS-%';
    UPDATE master.stoppage_code SET applies_to = 'ANN'
      WHERE (applies_to IS NULL OR TRIM(applies_to) = '') AND stoppage_code ILIKE 'ANN-%';
    UPDATE master.stoppage_code SET applies_to = 'RWD'
      WHERE (applies_to IS NULL OR TRIM(applies_to) = '') AND stoppage_code ILIKE 'RWD-%';
    UPDATE master.stoppage_code SET applies_to = 'CRS'
      WHERE (applies_to IS NULL OR TRIM(applies_to) = '') AND stoppage_code ILIKE 'CRS-%';
    UPDATE master.stoppage_code SET applies_to = 'CTL'
      WHERE (applies_to IS NULL OR TRIM(applies_to) = '') AND stoppage_code ILIKE 'CTL-%';
    UPDATE master.stoppage_code SET applies_to = 'SKP'
      WHERE (applies_to IS NULL OR TRIM(applies_to) = '') AND stoppage_code ILIKE 'SKP-%';
    UPDATE master.stoppage_code SET applies_to = 'CRM6'
      WHERE (applies_to IS NULL OR TRIM(applies_to) = '')
        AND stoppage_code ~ '^[0-9]{1,2}$';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM master.stoppage_code
    WHERE stoppage_code ~ '^(0[1-9]|1[0-6])$'
      AND applies_to = 'CRM6';
  `);
};
