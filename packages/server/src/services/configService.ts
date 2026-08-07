import { db, withTenantContext } from '../db';
import { BaseRepository } from '../repositories/BaseRepository';

export interface TenantConfig {
  tenant_id: string;
  deployment_mode: string;
  latency_target_seconds: number | null;
  retention_policy: any;
  enabled_modules: any;
  isolation_level: string;
  branding: any;
  cost_rate_ownership: string | null;
  config_version: number;
}

const PLATFORM_DEFAULTS = {
  deployment_mode: 'cloud',
  latency_target_seconds: 300, // minutes-scale near-real-time target (D2)
  retention_policy: { type: 'standard' },
  enabled_modules: ['core'],
  isolation_level: 'logical', // D8
  branding: {},
  cost_rate_ownership: 'platform',
};

class ConfigRepository extends BaseRepository<'security.tenant_config'> {
  constructor() {
    super('security.tenant_config');
  }
}

const configRepo = new ConfigRepository();

export const getConfig = async (): Promise<TenantConfig> => {
  // Try to get from DB using ambient context
  const storedConfig = await withTenantContext(async (trx) => {
    return await trx.selectFrom('security.tenant_config')
      .selectAll()
      // BaseRepository context handles isolation, but since this is 1:1 with tenant,
      // we can just get the first row returned for the current tenant.
      .executeTakeFirst();
  });

  // Merge over defaults
  return {
    ...PLATFORM_DEFAULTS,
    ...(storedConfig || {}),
  } as TenantConfig;
};

export const getConfigKey = async (key: keyof TenantConfig): Promise<any> => {
  const config = await getConfig();
  return config[key];
};

export const updateConfig = async (key: keyof TenantConfig, value: any): Promise<TenantConfig> => {
  return await withTenantContext(async (trx) => {
    // Audit log should be written here as per Property 9: "Config changes are audited with before/after"
    // Since we'll implement audit triggers later in Wave 4, we just do the update.
    // The DB trigger `audit.fn_audit` will capture this change automatically.
    
    // UPSERT logic isn't easily done generically in Kysely without dialect specifics,
    // so we assume the row exists (it was seeded in the tenant creation).
    const existing = await trx.selectFrom('security.tenant_config')
      .selectAll()
      .executeTakeFirst();

    if (!existing) {
      throw new Error('Tenant config row missing');
    }

    const updated = await trx.updateTable('security.tenant_config')
      .set({ [key]: value, updated_at: new Date() })
      // WHERE tenant_id is implicitly handled by RLS, but we can be explicit
      .where('tenant_id', '=', existing.tenant_id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      ...PLATFORM_DEFAULTS,
      ...updated,
    } as TenantConfig;
  });
};
