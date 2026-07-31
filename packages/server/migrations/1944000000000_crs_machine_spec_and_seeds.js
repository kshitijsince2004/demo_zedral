/** CRS machine envelope + pass metadata + CRS stoppage/defect seeds. */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS master.machine_spec (
      spec_id BIGSERIAL PRIMARY KEY,
      machine_code TEXT NOT NULL REFERENCES master.machine(machine_code),
      rev INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
      width_min_mm NUMERIC NULL,
      width_max_mm NUMERIC NULL,
      thk_min_mm NUMERIC NULL,
      thk_max_mm NUMERIC NULL,
      mandrel_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      coil_wt_min_mt NUMERIC NULL,
      coil_wt_max_mt NUMERIC NULL,
      exit_od_max_mm NUMERIC NULL,
      line_speed_mpm NUMERIC NULL,
      cutter_dia_mm NUMERIC NULL,
      air_mode TEXT NULL,
      is_reference_seed BOOLEAN NOT NULL DEFAULT false,
      notes TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      activated_at TIMESTAMPTZ NULL,
      created_by INTEGER NULL,
      UNIQUE (machine_code, rev)
    );

    CREATE INDEX IF NOT EXISTS ix_machine_spec_active
      ON master.machine_spec (machine_code)
      WHERE status = 'ACTIVE';

    ALTER TABLE txn.prod_crs
      ADD COLUMN IF NOT EXISTS crew_ref TEXT NULL,
      ADD COLUMN IF NOT EXISTS spec_version_id BIGINT NULL;

    -- CRS log-sheet stoppage codes 01–16 (process-scoped catalogue)
    INSERT INTO master.stoppage_code (stoppage_code, description, category, is_planned, is_active)
    VALUES
      ('CRS-01', 'Mechanical', 'MECH', false, true),
      ('CRS-02', 'Electrical', 'ELECT', false, true),
      ('CRS-03', 'Hydraulic', 'MECH', false, true),
      ('CRS-04', 'Pneumatic', 'MECH', false, true),
      ('CRS-05', 'Utility / Power', 'ELECT', false, true),
      ('CRS-06', 'Material Wait', 'OPN', true, true),
      ('CRS-07', 'Plan / PPC Wait', 'OPN', true, true),
      ('CRS-08', 'Quality Hold', 'OPN', true, true),
      ('CRS-09', 'Tooling Change', 'OPN', false, true),
      ('CRS-10', 'Knife Change', 'OPN', false, true),
      ('CRS-11', 'Mandrel / ID Change', 'OPN', false, true),
      ('CRS-12', 'Coil Handling', 'OPN', false, true),
      ('CRS-13', 'Packaging Wait', 'OPN', true, true),
      ('CRS-14', 'Break / Meal', 'OPN', true, true),
      ('CRS-15', 'Other Operational', 'OPN', false, true),
      ('CRS-16', 'Setting Adjustment', 'OPN', false, true)
    ON CONFLICT (stoppage_code) DO NOTHING;

    INSERT INTO master.defect_code (defect_code, symbol, description, applies_to, is_active)
    VALUES
      ('CRS-CAM', 'CAM', 'Camber out of band', 'CRS', true),
      ('CRS-WAV', 'WAV', 'Waviness / flatness', 'CRS', true),
      ('CRS-BUR', 'BUR', 'Burr high', 'CRS', true),
      ('CRS-RA', 'RA', 'Ra out of band', 'CRS', true),
      ('CRS-RZ', 'RZ', 'Rz out of band', 'CRS', true),
      ('CRS-WD', 'WD', 'Width out of band', 'CRS', true),
      ('CRS-THK', 'THK', 'Thickness out of band', 'CRS', true),
      ('CRS-SCR', 'SCR', 'Surface scratch', 'CRS', true),
      ('CRS-OTH', 'OTH', 'Other CRS defect', 'CRS', true)
    ON CONFLICT (defect_code) DO NOTHING;

    -- Ensure CRS1–6 exist as machines (no-op if present)
    INSERT INTO master.machine (machine_code, name, process_code, machine_status, machine_type)
    SELECT v.code, v.name, 'CRS', 'OPERATIONAL', 'SLITTER'
    FROM (VALUES
      ('CRS1', 'CR Slitter 1'),
      ('CRS2', 'CR Slitter 2'),
      ('CRS3', 'CR Slitter 3'),
      ('CRS4', 'CR Slitter 4'),
      ('CRS5', 'CR Slitter 5'),
      ('CRS6', 'CR Slitter 6')
    ) AS v(code, name)
    WHERE NOT EXISTS (
      SELECT 1 FROM master.machine m WHERE m.machine_code = v.code
    );

    -- Reference-only Annexure-IX style seed (CRS6 flagged wrong-size in plan)
    INSERT INTO master.machine_spec (
      machine_code, rev, status, width_min_mm, width_max_mm, thk_min_mm, thk_max_mm,
      mandrel_ids, coil_wt_min_mt, coil_wt_max_mt, exit_od_max_mm, is_reference_seed, notes, activated_at
    )
    SELECT v.machine_code, 1, 'ACTIVE', v.wmin, v.wmax, v.tmin, v.tmax,
           v.ids::jsonb, v.wtmin, v.wtmax, v.od, true, v.notes, now()
    FROM (VALUES
      ('CRS1', 20, 1250, 0.2, 3.0, '[400,500]', 1, 15, 1800, 'Annexure-IX reference seed'),
      ('CRS2', 20, 1250, 0.2, 3.0, '[400,500,600]', 1, 18, 1800, 'Annexure-IX reference seed'),
      ('CRS3', 20, 1000, 0.2, 2.5, '[500]', 1, 12, 1600, 'Annexure-IX reference seed'),
      ('CRS4', 20, 1250, 0.2, 3.0, '[400,500]', 1, 15, 1800, 'Annexure-IX reference seed'),
      ('CRS5', 20, 1250, 0.2, 3.0, '[400,500]', 1, 15, 1800, 'Annexure-IX reference seed'),
      ('CRS6', 20, 1600, 0.2, 4.0, '[400,500,600]', 2, 25, 2000, 'Annexure-IX reference seed — CRS6 sheet ratings known wrong; treat as advisory')
    ) AS v(machine_code, wmin, wmax, tmin, tmax, ids, wtmin, wtmax, od, notes)
    WHERE NOT EXISTS (
      SELECT 1 FROM master.machine_spec s
      WHERE s.machine_code = v.machine_code AND s.rev = 1
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM master.defect_code WHERE defect_code LIKE 'CRS-%' AND defect_code <> 'CRS-D1';
    DELETE FROM master.stoppage_code WHERE stoppage_code LIKE 'CRS-%' AND stoppage_code NOT IN ('CRS-QG');
    ALTER TABLE txn.prod_crs
      DROP COLUMN IF EXISTS crew_ref,
      DROP COLUMN IF EXISTS spec_version_id;
    DROP TABLE IF EXISTS master.machine_spec;
  `);
};
