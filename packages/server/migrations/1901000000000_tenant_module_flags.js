exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE security.tenant_config
      ADD COLUMN IF NOT EXISTS flags JSONB NOT NULL DEFAULT '{"module.m1_collection": true}'::jsonb;

    UPDATE security.tenant_config
    SET
      flags = COALESCE(flags, '{}'::jsonb) || '{"module.m1_collection": true}'::jsonb,
      enabled_modules = CASE
        WHEN enabled_modules IS NULL THEN '["M1"]'::jsonb
        WHEN enabled_modules @> '["M1"]'::jsonb THEN enabled_modules
        ELSE enabled_modules || '["M1"]'::jsonb
      END,
      updated_at = now();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE security.tenant_config
    SET
      flags = flags - 'module.m1_collection',
      enabled_modules = (
        SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
        FROM jsonb_array_elements_text(COALESCE(enabled_modules, '[]'::jsonb)) AS t(value)
        WHERE value <> 'M1'
      ),
      updated_at = now();

    ALTER TABLE security.tenant_config
      DROP COLUMN IF EXISTS flags;
  `);
};
