import { db } from '../src/db';
import { sql } from 'kysely';

async function migrate() {
  console.log('Starting Phase 8 migration...');

  try {
    // 1. Create txn.validation_overrides
    await sql`
      CREATE TABLE IF NOT EXISTS txn.validation_overrides (
          override_id     BIGSERIAL    PRIMARY KEY,
          shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
          field_path      VARCHAR(120) NOT NULL,
          reason          VARCHAR(300) NOT NULL,
          override_by     INTEGER      NOT NULL REFERENCES security.app_user(user_id),
          created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
      );
    `.execute(db);
    console.log('Created txn.validation_overrides table.');

    // 2. Add proposed_changes to audit.change_request
    await sql`
      ALTER TABLE audit.change_request
      ADD COLUMN IF NOT EXISTS proposed_changes JSONB;
    `.execute(db);
    console.log('Added proposed_changes to audit.change_request.');

    // 3. Add reject_reason to txn.shift_log
    await sql`
      ALTER TABLE txn.shift_log
      ADD COLUMN IF NOT EXISTS reject_reason VARCHAR(300);
    `.execute(db);
    console.log('Added reject_reason to txn.shift_log.');

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit(0);
  }
}

migrate();
