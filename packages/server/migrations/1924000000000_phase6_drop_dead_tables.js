/**
 * Phase 6 - Prune canonical/master leftovers.
 * Drops canon.cost_rate and canon.personnel - tables with zero code references
 * and no known roadmap need, guarded by an FK check that uses to_regclass.
 */

function fkGuardedDrop(schemaName, tableName) {
  return (
    "DO $$ BEGIN" +
    " IF to_regclass('" + schemaName + "." + tableName + "') IS NOT NULL THEN" +
    "   IF EXISTS (" +
    "     SELECT 1 FROM pg_constraint" +
    "     WHERE contype = 'f'" +
    "       AND confrelid = ('" + schemaName + "." + tableName + "')::regclass" +
    "   ) THEN" +
    "     RAISE EXCEPTION '%" + " still has inbound FK references - review before dropping', '" + schemaName + "." + tableName + "';" +
    "   ELSE" +
    "     EXECUTE 'DROP TABLE " + schemaName + "." + tableName + "';" +
    "     RAISE NOTICE 'Dropped table %', '" + schemaName + "." + tableName + "';" +
    "   END IF;" +
    " ELSE" +
    "   RAISE NOTICE 'Table % does not exist, skipping', '" + schemaName + "." + tableName + "';" +
    " END IF;" +
    "END $$"
  );
}

exports.up = async (pgm) => {
  await pgm.db.query(fkGuardedDrop('canon', 'cost_rate'));
  await pgm.db.query(fkGuardedDrop('canon', 'personnel'));
};

exports.down = (pgm) => {
  pgm.sql(
    "CREATE TABLE IF NOT EXISTS canon.cost_rate (" +
    "  cost_rate_id UUID PRIMARY KEY DEFAULT gen_random_uuid()," +
    "  equipment_node_id UUID REFERENCES canon.equipment_node(equipment_node_id)," +
    "  effective_from DATE NOT NULL," +
    "  effective_to DATE," +
    "  cost_per_mt NUMERIC(12,4)," +
    "  currency VARCHAR(8) NOT NULL DEFAULT 'INR'," +
    "  cost_rate_ownership VARCHAR(20) NOT NULL DEFAULT 'platform'," +
    "  tenant_id UUID NOT NULL DEFAULT current_setting('app.current_tenant', true)::uuid" +
    ")"
  );

  pgm.sql(
    "CREATE TABLE IF NOT EXISTS canon.personnel (" +
    "  personnel_id UUID PRIMARY KEY DEFAULT gen_random_uuid()," +
    "  user_id INTEGER REFERENCES security.app_user(user_id)," +
    "  equipment_node_id UUID REFERENCES canon.equipment_node(equipment_node_id)," +
    "  role_code VARCHAR(30) NOT NULL," +
    "  valid_from DATE NOT NULL," +
    "  valid_to DATE," +
    "  tenant_id UUID NOT NULL DEFAULT current_setting('app.current_tenant', true)::uuid" +
    ")"
  );
};
