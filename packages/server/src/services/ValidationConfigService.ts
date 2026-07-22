import { Kysely } from 'kysely';
import { DB } from '../db-types';
import { ValidationRule, EffectiveRuleset, isKnownField } from '@m1/shared-validation';
import { getAppCache } from '../cache';
import { getTenantId } from '../context';
import { tenantCacheKey } from '../cache/types';

export class ValidationConfigService {
  constructor(private db: Kysely<DB>) {}

  private cacheKey(...parts: string[]): string {
    return tenantCacheKey(getTenantId(), 'validation', ...parts);
  }

  private async invalidateCache(): Promise<void> {
    await getAppCache().del(this.cacheKey());
  }

  /**
   * Fetch all rules that are defined in the database by configurers.
   * Only returns active rules unless includeInactive is true.
   */
  async getConfiguredRules(includeInactive = false): Promise<ValidationRule[]> {
    const cacheKey = this.cacheKey('rules', `includeInactive_${includeInactive}`);
    const cached = await getAppCache().get<ValidationRule[]>(cacheKey);
    if (cached) return cached;

    let query = this.db.selectFrom('config.validation_rule').selectAll();
    
    if (!includeInactive) {
      query = query.where('is_active', '=', true);
    }

    const rows = await query.execute();

    const result = rows.map(row => ({
      ruleId: row.rule_id,
      fieldId: row.field_id,
      origin: 'CONFIGURER' as const,
      isActive: row.is_active,
      severity: row.severity as 'BLOCK' | 'WARN',
      type: row.rule_type as any,
      params: row.params as any,
      processCode: row.process_code ?? undefined,
      machineCode: row.machine_code ?? undefined,
      appliesWhen: row.applies_when as any ?? undefined,
    }));

    await getAppCache().set(cacheKey, result, 60);
    return result;
  }

  /**
   * Get the current published ruleset version
   */
  async getVersion(): Promise<number> {
    const cacheKey = this.cacheKey('rules_version');
    const cached = await getAppCache().get<number>(cacheKey);
    if (cached) return cached;

    const row = await this.db
      .selectFrom('config.ruleset_version')
      .select('version')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    
    const version = row?.version ?? 1;
    await getAppCache().set(cacheKey, version, 60);
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

  async upsertRule(
    ruleId: string | undefined,
    fieldId: string, 
    ruleData: Omit<ValidationRule, 'fieldId' | 'origin' | 'ruleId'>,
    username: string
  ): Promise<void> {
    if (!isKnownField(fieldId)) {
      throw new Error(`Cannot configure unknown field: ${fieldId}`);
    }

    await this.db.transaction().execute(async (trx) => {
      if (ruleId) {
        // Update existing rule
        await trx
          .updateTable('config.validation_rule')
          .set({
            field_id: fieldId,
            rule_type: ruleData.type,
            severity: ruleData.severity,
            is_active: ruleData.isActive,
            params: JSON.stringify(ruleData.params),
            process_code: ruleData.processCode ?? null,
            machine_code: ruleData.machineCode ?? null,
            applies_when: ruleData.appliesWhen ? JSON.stringify(ruleData.appliesWhen) : null,
            updated_by: username,
            updated_at: new Date()
          })
          .where('rule_id', '=', ruleId)
          .execute();
      } else {
        // Upsert rule (insert new or update if logical duplicate)
        await trx
          .insertInto('config.validation_rule')
          .values({
            field_id: fieldId,
            rule_type: ruleData.type,
            severity: ruleData.severity,
            is_active: ruleData.isActive,
            params: JSON.stringify(ruleData.params),
            process_code: ruleData.processCode ?? null,
            machine_code: ruleData.machineCode ?? null,
            applies_when: ruleData.appliesWhen ? JSON.stringify(ruleData.appliesWhen) : null,
            updated_by: username,
            updated_at: new Date()
          })
          .onConflict((oc) => oc
            .columns(['field_id', 'rule_type', 'process_code', 'machine_code'])
            .doUpdateSet({
              severity: ruleData.severity,
              is_active: ruleData.isActive,
              params: JSON.stringify(ruleData.params),
              applies_when: ruleData.appliesWhen ? JSON.stringify(ruleData.appliesWhen) : null,
              updated_by: username,
              updated_at: new Date()
            })
          )
          .execute();
      }

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
    await this.invalidateCache();
  }

  async getFieldHistory(fieldId: string): Promise<any[]> {
    const history = await this.db
      .selectFrom('audit.audit_log')
      .selectAll()
      .where('table_name', '=', 'config.validation_rule')
      .orderBy('ts', 'desc')
      .execute();
      
    return history.filter(h => {
      try {
        if (h.new_value) {
          const p = JSON.parse(h.new_value);
          if (p.field_id === fieldId) return true;
        }
        if (h.old_value) {
          const p = JSON.parse(h.old_value);
          if (p.field_id === fieldId) return true;
        }
      } catch (e) {}
      return false;
    });
  }

  async updateRule(fieldId: string, ruleData: Omit<ValidationRule, 'fieldId' | 'origin' | 'ruleId'>, username: string): Promise<void> {
    return this.upsertRule(undefined, fieldId, ruleData, username);
  }
  /**
   * Deactivate a configuration rule
   */
  async deactivateRule(ruleId: string, username: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('config.validation_rule')
        .set({
          is_active: false,
          updated_by: username,
          updated_at: new Date()
        })
        .where('rule_id', '=', ruleId)
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

    await this.invalidateCache();
  }

  /**
   * Get audit history for a specific rule
   */
  async getRuleHistory(ruleId: string): Promise<any[]> {
    const history = await this.db
      .selectFrom('audit.audit_log')
      .selectAll()
      .where('table_name', '=', 'config.validation_rule')
      .where('record_pk', '=', ruleId)
      .orderBy('ts', 'desc')
      .execute();
      
    return history;
  }
}
