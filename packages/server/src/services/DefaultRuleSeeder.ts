import { Kysely } from 'kysely';
import { DB } from '../db-types';
import { FIELD_REGISTRY } from '@m1/shared-validation';

export class DefaultRuleSeeder {
  constructor(private db: Kysely<DB>) {}

  /**
   * Seed the config.validation_rule table with all known fields from FIELD_REGISTRY.
   * This ensures the config table is fully populated for the frontend to list,
   * without overriding any rules that an admin has already configured.
   */
  async seed(): Promise<void> {
    if (FIELD_REGISTRY.length === 0) return;

    // Use a single transaction to insert all missing fields as inactive MANDATORY rules (just as a placeholder).
    // Or we could infer a better default from the schema if possible, but MANDATORY { mandatory: false } is safe.
    
    const values = FIELD_REGISTRY.map(field => ({
      field_id: field.fieldId,
      rule_type: 'MANDATORY',
      severity: 'WARN',
      is_active: false,
      params: JSON.stringify({ mandatory: true }),
      updated_by: 'system',
      updated_at: new Date()
    }));

    // Batch insert
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('config.validation_rule')
        .values(values)
        .onConflict((oc) => oc.column('field_id').doNothing())
        .execute();
    });
  }
}
