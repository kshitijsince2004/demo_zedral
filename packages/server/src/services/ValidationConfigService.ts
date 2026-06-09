import { Kysely } from 'kysely';
import { DB } from '../db-types';
import { ValidationRule, EffectiveRuleset, isKnownField } from '@m1/shared-validation';
import NodeCache from 'node-cache';

export class ValidationConfigService {
  private cache = new NodeCache({ stdTTL: 60 }); // 1 min TTL

  constructor(private db: Kysely<DB>) {}

  /**
   * Fetch all rules that are defined in the database by configurers.
   * Only returns active rules unless includeInactive is true.
   */
  async getConfiguredRules(includeInactive = false): Promise<ValidationRule[]> {
    const cacheKey = `rules_includeInactive_${includeInactive}`;
    const cached = this.cache.get<ValidationRule[]>(cacheKey);
    if (cached) return cached;

    let query = this.db.selectFrom('config.validation_rule').selectAll();
    
    if (!includeInactive) {
      query = query.where('is_active', '=', true);
    }

    const rows = await query.execute();

    const result = rows.map(row => ({
      fieldId: row.field_id,
      origin: 'CONFIGURER' as const,
      isActive: row.is_active,
      severity: row.severity as 'BLOCK' | 'WARN',
      type: row.rule_type as any,
      params: row.params as any,
    }));

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get the current published ruleset version
   */
  async getVersion(): Promise<number> {
    const cacheKey = `rules_version`;
    const cached = this.cache.get<number>(cacheKey);
    if (cached) return cached;

    const row = await this.db
      .selectFrom('config.ruleset_version')
      .select('version')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    
    const version = row?.version ?? 1;
    this.cache.set(cacheKey, version);
    return version;
  }

  /**
   * Bump the ruleset version, signifying a config change
   */
  private async bumpVersion(username: string = 'system'): Promise<number> {
    const current = await this.getVersion();
    const nextVersion = current + 1;
    
    await this.db
      .insertInto('config.ruleset_version')
      .values({
        version: nextVersion,
        published_by: username
      })
      .execute();
      
    return nextVersion;
  }

  /**
   * Update or create a configuration rule for a specific field
   */
  async updateRule(
    fieldId: string, 
    ruleData: Omit<ValidationRule, 'fieldId' | 'origin'>,
    username: string
  ): Promise<void> {
    if (!isKnownField(fieldId)) {
      throw new Error(`Cannot configure unknown field: ${fieldId}`);
    }

    await this.db.transaction().execute(async (trx) => {
      // Upsert the rule
      await trx
        .insertInto('config.validation_rule')
        .values({
          field_id: fieldId,
          rule_type: ruleData.type,
          severity: ruleData.severity,
          is_active: ruleData.isActive,
          params: JSON.stringify(ruleData.params),
          updated_by: username,
          updated_at: new Date()
        })
        .onConflict((oc) => oc
          .column('field_id')
          .doUpdateSet({
            rule_type: ruleData.type,
            severity: ruleData.severity,
            is_active: ruleData.isActive,
            params: JSON.stringify(ruleData.params),
            updated_by: username,
            updated_at: new Date()
          })
        )
        .execute();

      // Bump version
      const current = await trx
        .selectFrom('config.ruleset_version')
        .select('version')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
        
      const nextVersion = (current?.version ?? 1) + 1;
      
      await trx
        .insertInto('config.ruleset_version')
        .values({
          version: nextVersion,
          published_by: username
        })
        .execute();
    });

    // Invalidate cache
    this.cache.flushAll();
  }
  /**
   * Deactivate a configuration rule for a specific field
   */
  async deactivateRule(fieldId: string, username: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('config.validation_rule')
        .set({
          is_active: false,
          updated_by: username,
          updated_at: new Date()
        })
        .where('field_id', '=', fieldId)
        .executeTakeFirst();
      
      if (Number(result.numUpdatedRows) > 0) {
        // Bump version
        const current = await trx
          .selectFrom('config.ruleset_version')
          .select('version')
          .orderBy('id', 'desc')
          .limit(1)
          .executeTakeFirst();
          
        const nextVersion = (current?.version ?? 1) + 1;
        
        await trx
          .insertInto('config.ruleset_version')
          .values({
            version: nextVersion,
            published_by: username
          })
          .execute();
      }
    });

    this.cache.flushAll();
  }

  /**
   * Get audit history for a specific field
   */
  async getFieldHistory(fieldId: string): Promise<any[]> {
    const history = await this.db
      .selectFrom('audit.audit_log')
      .selectAll()
      .where('table_name', '=', 'config.validation_rule')
      .where('record_pk', '=', fieldId)
      .orderBy('ts', 'desc')
      .execute();
      
    return history;
  }
}
