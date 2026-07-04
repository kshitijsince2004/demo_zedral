export const M1_MODULE_CODE = 'M1' as const;

export const m1ManifestMeta = {
  code: M1_MODULE_CODE,
  name: 'Digital Data Collection',
  dbSchema: 'txn',
  featureFlag: 'module.m1_collection',
  mountPath: '/',
  consumesEvents: [] as const,
  producesEvents: [
    'shift.closed',
    'downtime.logged',
    'production.counted',
    'production.captured',
    'defect.logged',
  ] as const,
  consumesCanonical: [] as const,
  dependsOn: [] as const,
  migrationsPath: 'packages/server/migrations/modules/m1',
};
