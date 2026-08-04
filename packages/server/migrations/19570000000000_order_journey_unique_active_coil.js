/**
 * One ACTIVE journey per coil — closes V3 race in createJourney.
 * Pre-dedupes duplicate ACTIVE journeys (keeps newest), then adds partial unique index.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    WITH ranked AS (
      SELECT journey_id,
             ROW_NUMBER() OVER (
               PARTITION BY coil_no
               ORDER BY journey_id DESC
             ) AS rn
      FROM planning.order_journey
      WHERE status = 'ACTIVE'
    )
    UPDATE planning.order_journey j
    SET status = 'COMPLETED',
        updated_at = now()
    FROM ranked r
    WHERE j.journey_id = r.journey_id
      AND r.rn > 1;

    CREATE UNIQUE INDEX IF NOT EXISTS ux_order_journey_active_coil
      ON planning.order_journey (coil_no)
      WHERE status = 'ACTIVE';
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS planning.ux_order_journey_active_coil;
  `);
};
