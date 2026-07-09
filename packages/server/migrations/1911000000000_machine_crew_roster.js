/** Machine Head crew roster for shift handover quick-select. */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS master.machine_crew_roster (
      crew_id       BIGSERIAL PRIMARY KEY,
      machine_code  TEXT NOT NULL REFERENCES master.machine(machine_code) ON DELETE CASCADE,
      member_name   TEXT NOT NULL,
      role_label    TEXT NOT NULL,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS ix_machine_crew_roster_machine
      ON master.machine_crew_roster (machine_code)
      WHERE is_active = TRUE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS master.machine_crew_roster;`);
};
