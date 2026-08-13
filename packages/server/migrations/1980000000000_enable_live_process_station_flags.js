/**
 * 1932 seeded station.* flags as false when NODE_ENV=production (Docker QA/Factory).
 * HRS/PKL/ANN/RWD are live; a false flag sent operators into a /capture ↔ home
 * redirect loop (white screen + Chrome navigation throttle).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE security.tenant_config
    SET
      flags = COALESCE(flags, '{}'::jsonb) || '{
        "station.hrs": true,
        "station.pkl": true,
        "station.ann": true,
        "station.rwd": true
      }'::jsonb,
      updated_at = now();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE security.tenant_config
    SET
      flags = flags
        || '{"station.hrs": false, "station.pkl": false, "station.ann": false, "station.rwd": false}'::jsonb,
      updated_at = now();
  `);
};
