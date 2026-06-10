/**
 * Seed 6HI defect codes and stoppage categories for operator workflows.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO master.stoppage_category (category_code, label, requires_breakdown_code) VALUES
    ('01', 'Mechanical', FALSE),
    ('02', 'Electrical', FALSE),
    ('03', 'Crane', FALSE),
    ('04', 'Work Roll Change', FALSE),
    ('05', 'H.V.L.V.', FALSE),
    ('06', 'Backup Roll Change', FALSE),
    ('07', 'Raw Material', FALSE),
    ('08', 'Services', FALSE),
    ('09', 'Preventive Maintenance', FALSE),
    ('10', 'Short of Man', FALSE),
    ('11', 'Power Failure', FALSE),
    ('12', 'Operational', FALSE),
    ('13', 'No Planning', FALSE),
    ('14', 'Hydraulic', FALSE),
    ('15', 'Material Short Due to Crane Breakdown', FALSE),
    ('16', 'Setting Adjustment', FALSE)
    ON CONFLICT (category_code) DO UPDATE SET
      label = EXCLUDED.label,
      requires_breakdown_code = EXCLUDED.requires_breakdown_code;

    INSERT INTO master.defect_code (defect_code, symbol, description, applies_to, is_active) VALUES
    ('1',  'GV', 'Gauge Variation', 'CRM6', TRUE),
    ('2',  'EC', 'Edge Cut', 'CRM6', TRUE),
    ('3',  'SL', 'Slivers', 'CRM6', TRUE),
    ('4',  'SM', 'Sticker Mark', 'CRM6', TRUE),
    ('5',  'SL', 'Seam Lines', 'CRM6', TRUE),
    ('6',  'SC', 'Scratches', 'CRM6', TRUE),
    ('7',  'RU', 'Rusty', 'CRM6', TRUE),
    ('8',  'SP', 'Slippage Mark', 'CRM6', TRUE),
    ('9',  'HO', 'Holes', 'CRM6', TRUE),
    ('10', 'RM', 'Roll Mark', 'CRM6', TRUE),
    ('11', 'BS', 'Black Surface', 'CRM6', TRUE),
    ('12', 'WR', 'Wrinkles', 'CRM6', TRUE),
    ('13', 'CB', 'Camber', 'CRM6', TRUE),
    ('14', 'LE', 'Low ECV', 'CRM6', TRUE),
    ('15', 'LH', 'Low/High Hardness', 'CRM6', TRUE),
    ('16', 'WV', 'Waviness', 'CRM6', TRUE),
    ('17', 'LM', 'Lamination', 'CRM6', TRUE),
    ('18', 'PT', 'Pitting', 'CRM6', TRUE),
    ('20', 'RS', 'Rolled In Scale', 'CRM6', TRUE),
    ('21', 'WV', 'Width Variation', 'CRM6', TRUE),
    ('22', 'UT', 'Low/High UTS', 'CRM6', TRUE),
    ('23', 'BK', 'Buckling', 'CRM6', TRUE),
    ('24', 'EL', 'Low Elongation', 'CRM6', TRUE),
    ('25', 'OC', 'Off Chemistry', 'CRM6', TRUE),
    ('29', 'OP', 'Orange Peel', 'CRM6', TRUE),
    ('30', 'DS', 'Dull Surface', 'CRM6', TRUE),
    ('31', 'NO', 'No Oiling', 'CRM6', TRUE),
    ('32', 'FM', 'Folding Marks', 'CRM6', TRUE),
    ('33', 'CB', 'Coil Brake Line', 'CRM6', TRUE),
    ('34', 'EB', 'Edge Bend', 'CRM6', TRUE),
    ('35', 'CM', 'Chips Mark', 'CRM6', TRUE),
    ('36', 'TD', 'Transit Damage', 'CRM6', TRUE),
    ('39', 'HP', 'Hump', 'CRM6', TRUE),
    ('40', 'SF', 'Shearing Fault', 'CRM6', TRUE),
    ('41', 'TP', 'Taper', 'CRM6', TRUE),
    ('43', 'UP', 'Under Pickled', 'CRM6', TRUE),
    ('44', 'YS', 'Yellow Stain', 'CRM6', TRUE),
    ('45', 'SM', 'Soft Mark', 'CRM6', TRUE)
    ON CONFLICT (defect_code) DO UPDATE SET
      description = EXCLUDED.description,
      applies_to = EXCLUDED.applies_to,
      is_active = EXCLUDED.is_active;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = () => {
  // Master data is retained on rollback.
};
