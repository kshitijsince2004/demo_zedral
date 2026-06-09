/** M1 Export Module Phase 1 — canonical read model masters. */
exports.up = (pgm) => {
  pgm.sql(`
    -- DPR line areas (26 rows per spec §6.1)
    CREATE TABLE IF NOT EXISTS master.line_area (
        area_code               VARCHAR(16)  PRIMARY KEY,
        name                    VARCHAR(40)  NOT NULL,
        process_code            VARCHAR(8)   REFERENCES master.process(code),
        dpr_area_label          VARCHAR(40)  NOT NULL,
        operating_minutes_base  INTEGER      NOT NULL DEFAULT 1440,
        is_dpr_reported         BOOLEAN      NOT NULL DEFAULT TRUE,
        sort_order              SMALLINT     NOT NULL
    );

    INSERT INTO master.line_area
      (area_code, name, process_code, dpr_area_label, operating_minutes_base, is_dpr_reported, sort_order)
    VALUES
      ('HRS',     'HR Slitting',       'HRS',  'HRS',       1440,   TRUE,  1),
      ('PKLG',    'Pickling',          'PKL',  'PKLG',      1440,   TRUE,  2),
      ('4HI_R',   '4 Hi Rolling',      '6HI',  '4 Hi(R)',   1440,   TRUE,  3),
      ('4HI_RR',  '4 Hi Re-Rolling',   '6HI',  '4 Hi(RR)',  1440,   TRUE,  4),
      ('4HI_SP',  '4 Hi Skin Pass',    '6HI',  '4 Hi(SP)',  1440,   TRUE,  5),
      ('6HI_R',   '6 Hi Rolling',      '6HI',  '6 Hi(R)',   1440,   TRUE,  6),
      ('6HI_RR',  '6 Hi Re-Rolling',   '6HI',  '6 Hi(RR)',  1440,   TRUE,  7),
      ('6HI_SP',  '6 Hi Skin Pass',    '6HI',  '6HI SP',    1440,   TRUE,  8),
      ('2HI_SP',  '2 Hi Skin Pass',    '6HI',  '2 Hi(SP)',  1440,   TRUE,  9),
      ('2HI_RW',  '2 Hi Re-Rolling',   '6HI',  '2HIR/W',    1440,   TRUE,  10),
      ('RW_LINE', 'Rewinding Line',    'RWD',  'R/W LINE',  1440,   TRUE,  11),
      ('HPH',     'Annealing HPH',     'ANN',  'HPH',       23040,  TRUE,  12),
      ('CRS_1',   'CRS Line 1',        'CRS',  'CRS-1',     1440,   TRUE,  13),
      ('CRS_2',   'CRS Line 2',        'CRS',  'CRS-2',     1440,   TRUE,  14),
      ('CRS_3',   'CRS Line 3',        'CRS',  'CRS-3',     1440,   TRUE,  15),
      ('CRS_4',   'CRS Line 4',        'CRS',  'CRS-4',     1440,   TRUE,  16),
      ('CRS_5',   'CRS Line 5',        'CRS',  'CRS-5',     1440,   TRUE,  17),
      ('CRS_6',   'CRS Line 6',        'CRS',  'CRS-6',     1440,   TRUE,  18),
      ('CTL_1',   'CTL Line 1',        'CTL',  'CTL-1',     1440,   TRUE,  19),
      ('CTL_2',   'CTL Line 2',        'CTL',  'CTL-2',     1440,   TRUE,  20),
      ('CTL_3',   'CTL Line 3',        'CTL',  'CTL-3',     1440,   TRUE,  21),
      ('CTL_4',   'CTL Line 4',        'CTL',  'CTL-4',     1440,   TRUE,  22),
      ('CTL_5',   'CTL Line 5',        'CTL',  'CTL-5',     1440,   TRUE,  23),
      ('PKG',     'Packaging',         NULL,   'PKG',       1440,   TRUE,  24),
      ('WIP',     'Work In Progress',  NULL,   'WIP',       1440,   FALSE, 25),
      ('OT',      'Other',             NULL,   'O.T',       1440,   FALSE, 26)
    ON CONFLICT (area_code) DO NOTHING;

    -- Stoppage → DPR category mapping on shift-log stoppage codes
    ALTER TABLE master.stoppage_code
      ADD COLUMN IF NOT EXISTS dpr_category VARCHAR(40),
      ADD COLUMN IF NOT EXISTS agency_code  VARCHAR(4);

    ALTER TABLE master.stoppage_code
      DROP CONSTRAINT IF EXISTS stoppage_code_agency_check;

    ALTER TABLE master.stoppage_code
      ADD CONSTRAINT stoppage_code_agency_check
      CHECK (agency_code IS NULL OR agency_code IN ('OP', 'EL', 'MECH'));

    ALTER TABLE master.stoppage_code
      DROP CONSTRAINT IF EXISTS stoppage_code_dpr_category_check;

    ALTER TABLE master.stoppage_code
      ADD CONSTRAINT stoppage_code_dpr_category_check
      CHECK (dpr_category IS NULL OR dpr_category IN (
        'ELECTRICAL', 'MECHANICAL', 'OPERATIONAL', 'EQUIPMENT_AVAILABILITY',
        'PREVENTIVE_MAINTENANCE', 'POWER_FAILURE', 'NO_PLAN', 'RM_SHORTAGE'
      ));

    UPDATE master.stoppage_code SET
      agency_code = CASE category
        WHEN 'ELECT'  THEN 'EL'
        WHEN 'MECH'   THEN 'MECH'
        WHEN 'POWER'  THEN 'EL'
        ELSE 'OP'
      END,
      dpr_category = CASE category
        WHEN 'ELECT'   THEN 'ELECTRICAL'
        WHEN 'MECH'    THEN 'MECHANICAL'
        WHEN 'OPN'     THEN 'OPERATIONAL'
        WHEN 'UTILITY' THEN 'EQUIPMENT_AVAILABILITY'
        WHEN 'POWER'   THEN 'POWER_FAILURE'
        WHEN 'PLANNED' THEN 'PREVENTIVE_MAINTENANCE'
        ELSE 'OPERATIONAL'
      END
    WHERE dpr_category IS NULL;

    -- Order-level stoppage categories (CRM6)
    ALTER TABLE master.stoppage_category
      ADD COLUMN IF NOT EXISTS dpr_category VARCHAR(40),
      ADD COLUMN IF NOT EXISTS agency_code  VARCHAR(4);

    ALTER TABLE master.stoppage_category
      DROP CONSTRAINT IF EXISTS stoppage_category_agency_check;

    ALTER TABLE master.stoppage_category
      ADD CONSTRAINT stoppage_category_agency_check
      CHECK (agency_code IS NULL OR agency_code IN ('OP', 'EL', 'MECH'));

    ALTER TABLE master.stoppage_category
      DROP CONSTRAINT IF EXISTS stoppage_category_dpr_category_check;

    ALTER TABLE master.stoppage_category
      ADD CONSTRAINT stoppage_category_dpr_category_check
      CHECK (dpr_category IS NULL OR dpr_category IN (
        'ELECTRICAL', 'MECHANICAL', 'OPERATIONAL', 'EQUIPMENT_AVAILABILITY',
        'PREVENTIVE_MAINTENANCE', 'POWER_FAILURE', 'NO_PLAN', 'RM_SHORTAGE'
      ));

    UPDATE master.stoppage_category SET
      agency_code = CASE category_code
        WHEN 'BREAKDOWN'    THEN 'MECH'
        WHEN 'POWER'        THEN 'EL'
        ELSE 'OP'
      END,
      dpr_category = CASE category_code
        WHEN 'BREAKDOWN'    THEN 'MECHANICAL'
        WHEN 'WR_CHANGE'    THEN 'OPERATIONAL'
        WHEN 'MATERIAL'     THEN 'RM_SHORTAGE'
        WHEN 'POWER'        THEN 'POWER_FAILURE'
        WHEN 'SETUP'        THEN 'OPERATIONAL'
        WHEN 'QUALITY_HOLD' THEN 'OPERATIONAL'
        ELSE 'OPERATIONAL'
      END
    WHERE dpr_category IS NULL;

    -- Monthly / daily production targets per DPR area
    CREATE TABLE IF NOT EXISTS planning.production_target (
        target_id    BIGSERIAL    PRIMARY KEY,
        area_code    VARCHAR(16)  NOT NULL REFERENCES master.line_area(area_code),
        period       DATE         NOT NULL,
        target_mt    NUMERIC(12,3),
        target_rate  NUMERIC(10,3),
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        UNIQUE (area_code, period)
    );

    CREATE INDEX IF NOT EXISTS ix_production_target_period
      ON planning.production_target (period, area_code);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS planning.production_target;

    ALTER TABLE master.stoppage_category
      DROP CONSTRAINT IF EXISTS stoppage_category_dpr_category_check,
      DROP CONSTRAINT IF EXISTS stoppage_category_agency_check,
      DROP COLUMN IF EXISTS dpr_category,
      DROP COLUMN IF EXISTS agency_code;

    ALTER TABLE master.stoppage_code
      DROP CONSTRAINT IF EXISTS stoppage_code_dpr_category_check,
      DROP CONSTRAINT IF EXISTS stoppage_code_agency_check,
      DROP COLUMN IF EXISTS dpr_category,
      DROP COLUMN IF EXISTS agency_code;

    DROP TABLE IF EXISTS master.line_area;
  `);
};
