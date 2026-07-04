import type { TenantModuleConfig } from '@zedral/platform';
import { db } from '../db';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toFlagRecord(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const flags: Record<string, boolean> = {};
  for (const [key, flagValue] of Object.entries(value)) {
    if (typeof flagValue === 'boolean') {
      flags[key] = flagValue;
    }
  }
  return flags;
}

export async function getTenantModuleConfig(tenantId: string): Promise<TenantModuleConfig> {
  const row = await db
    .selectFrom('security.tenant_config')
    .select(['enabled_modules', 'flags'])
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();

  if (!row) {
    return {
      enabledModules: ['M1'],
      flags: { 'module.m1_collection': true },
    };
  }

  return {
    enabledModules: toStringArray(row.enabled_modules),
    flags: {
      'module.m1_collection': true,
      ...toFlagRecord(row.flags),
    },
  };
}
