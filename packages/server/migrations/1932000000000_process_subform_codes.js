/** Seed per-process stoppage and defect codes for All-Process Operator sub-forms. */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO master.stoppage_code (stoppage_code, description, category, is_planned, is_active)
    VALUES
      ('HRS-MECH', 'HRS mechanical stoppage', 'MECH', false, true),
      ('HRS-ELEC', 'HRS electrical stoppage', 'ELECT', false, true),
      ('PKL-OPN', 'PKL operational delay', 'OPN', false, true),
      ('PKL-ACID', 'PKL acid bath issue', 'MECH', false, true),
      ('ANN-FURN', 'ANN furnace issue', 'MECH', false, true),
      ('RWD-TENS', 'RWD tension fault', 'MECH', false, true),
      ('CRS-QG', 'CRS quality hold review', 'OPN', true, true),
      ('CTL-CUT', 'CTL cutting fault', 'MECH', false, true)
    ON CONFLICT (stoppage_code) DO NOTHING;

    INSERT INTO master.defect_code (defect_code, symbol, description, applies_to, is_active)
    VALUES
      ('HRS-S1', 'S1', 'HRS edge crack', 'HRS', true),
      ('HRS-S2', 'S2', 'HRS burr high', 'HRS', true),
      ('PKL-D1', 'D1', 'PKL pickle stain', 'PKL', true),
      ('PKL-D2', 'D2', 'PKL oxide patch', 'PKL', true),
      ('ANN-D1', 'D1', 'ANN anneal streak', 'ANN', true),
      ('RWD-D1', 'D1', 'RWD rewind mark', 'RWD', true),
      ('CRS-D1', 'D1', 'CRS camber defect', 'CRS', true),
      ('CTL-D01', '01', 'CTL edge wave', 'CTL', true),
      ('CTL-D02', '02', 'CTL camber out', 'CTL', true),
      ('CTL-D03', '03', 'CTL burr', 'CTL', true),
      ('CTL-D04', '04', 'CTL surface scratch', 'CTL', true),
      ('CTL-D05', '05', 'CTL coil set', 'CTL', true),
      ('CTL-D06', '06', 'CTL flatness fail', 'CTL', true),
      ('CTL-D07', '07', 'CTL squareness fail', 'CTL', true),
      ('CTL-D08', '08', 'CTL length variation', 'CTL', true),
      ('CTL-D09', '09', 'CTL width variation', 'CTL', true),
      ('CTL-D10', '10', 'CTL thickness variation', 'CTL', true),
      ('CTL-D11', '11', 'CTL edge damage', 'CTL', true),
      ('CTL-D12', '12', 'CTL oil stain', 'CTL', true),
      ('CTL-D13', '13', 'CTL rust spot', 'CTL', true),
      ('CTL-D14', '14', 'CTL lamination', 'CTL', true),
      ('CTL-D15', '15', 'CTL inclusion', 'CTL', true),
      ('CTL-D16', '16', 'CTL gauge band', 'CTL', true),
      ('CTL-D17', '17', 'CTL wedge', 'CTL', true),
      ('CTL-D18', '18', 'CTL center buckle', 'CTL', true),
      ('CTL-D19', '19', 'CTL quarter buckle', 'CTL', true),
      ('CTL-D20', '20', 'CTL edge wave severe', 'CTL', true),
      ('CTL-D21', '21', 'CTL cross bow', 'CTL', true),
      ('CTL-D22', '22', 'CTL twist', 'CTL', true),
      ('CTL-D23', '23', 'CTL coil collapse', 'CTL', true),
      ('CTL-D24', '24', 'CTL telescoping', 'CTL', true),
      ('CTL-D25', '25', 'CTL sticker stain', 'CTL', true),
      ('CTL-D26', '26', 'CTL handling dent', 'CTL', true),
      ('CTL-D27', '27', 'CTL shear burr', 'CTL', true),
      ('CTL-D28', '28', 'CTL end fold', 'CTL', true),
      ('CTL-D29', '29', 'CTL miss length', 'CTL', true),
      ('CTL-D30', '30', 'CTL miss width', 'CTL', true),
      ('CTL-D31', '31', 'CTL miss square', 'CTL', true),
      ('CTL-D32', '32', 'CTL miss flatness', 'CTL', true),
      ('CTL-D33', '33', 'CTL packaging damage', 'CTL', true),
      ('CTL-D34', '34', 'CTL label error', 'CTL', true),
      ('CTL-D35', '35', 'CTL bundle count error', 'CTL', true),
      ('CTL-D36', '36', 'CTL other defect', 'CTL', true)
    ON CONFLICT (defect_code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM master.defect_code WHERE defect_code LIKE 'CTL-D%' OR defect_code IN ('HRS-S1','HRS-S2','PKL-D1','PKL-D2','ANN-D1','RWD-D1','CRS-D1');
    DELETE FROM master.stoppage_code WHERE stoppage_code IN ('HRS-MECH','HRS-ELEC','PKL-OPN','PKL-ACID','ANN-FURN','RWD-TENS','CRS-QG','CTL-CUT');
  `);
};
