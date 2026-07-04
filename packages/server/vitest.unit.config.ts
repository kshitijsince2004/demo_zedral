import { defineConfig } from 'vitest/config';

const integrationPatterns = [
  'tests/integration/**',
  'tests/platform-security.test.ts',
  'tests/platform-config-authz.test.ts',
  'tests/platform-audit-lineage.test.ts',
  'tests/**/*.integration.test.ts',
  'tests/export/exportJobIntegration.test.ts',
  'tests/export/exportReadRepository.test.ts',
  'tests/shiftLogOperator.test.ts',
  'tests/ppcImportCoilOrder.test.ts',
  'tests/importDataIntegrity.preservation.test.ts',
  'tests/importDataIntegrity.exploration.test.ts',
  'tests/properties/export.property.test.ts',
  'tests/properties/shiftLogs.test.ts',
  'tests/properties/validationConfigService.property.test.ts',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', ...integrationPatterns],
    setupFiles: ['./tests/setupUnit.ts'],
    testTimeout: 15000,
  },
});
