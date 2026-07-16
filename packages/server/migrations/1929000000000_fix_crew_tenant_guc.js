/**
 * Fix tenant GUC name on crew tables.
 *
 * 1922000000000_unify_crew.js used current_setting('app.current_tenant') for
 * tenant_id defaults and RLS, but the app only sets app.tenant_id (db.ts).
 * That made the default NULL and broke handover accept inserts into
 * txn.session_crew.
 *
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = async (pgm) => {
  await pgm.db.query(`
    ALTER TABLE txn.session_crew
      ALTER COLUMN tenant_id
      SET DEFAULT current_setting('app.tenant_id', true)::uuid
  `);
  await pgm.db.query(`DROP POLICY IF EXISTS tenant_isolation ON txn.session_crew`);
  await pgm.db.query(`
    CREATE POLICY tenant_isolation ON txn.session_crew
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);

  const crewEntry = await pgm.db.query(`SELECT to_regclass('txn.crew_entry') AS reg`);
  if (crewEntry.rows[0] && crewEntry.rows[0].reg) {
    await pgm.db.query(`
      ALTER TABLE txn.crew_entry
        ALTER COLUMN tenant_id
        SET DEFAULT current_setting('app.tenant_id', true)::uuid
    `);
    await pgm.db.query(`DROP POLICY IF EXISTS tenant_isolation ON txn.crew_entry`);
    await pgm.db.query(`
      CREATE POLICY tenant_isolation ON txn.crew_entry
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    `);
  }
};

exports.down = async (pgm) => {
  await pgm.db.query(`
    ALTER TABLE txn.session_crew
      ALTER COLUMN tenant_id
      SET DEFAULT current_setting('app.current_tenant', true)::uuid
  `);
  await pgm.db.query(`DROP POLICY IF EXISTS tenant_isolation ON txn.session_crew`);
  await pgm.db.query(`
    CREATE POLICY tenant_isolation ON txn.session_crew
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  `);

  const crewEntry = await pgm.db.query(`SELECT to_regclass('txn.crew_entry') AS reg`);
  if (crewEntry.rows[0] && crewEntry.rows[0].reg) {
    await pgm.db.query(`
      ALTER TABLE txn.crew_entry
        ALTER COLUMN tenant_id
        SET DEFAULT current_setting('app.current_tenant', true)::uuid
    `);
    await pgm.db.query(`DROP POLICY IF EXISTS tenant_isolation ON txn.crew_entry`);
    await pgm.db.query(`
      CREATE POLICY tenant_isolation ON txn.crew_entry
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    `);
  }
};