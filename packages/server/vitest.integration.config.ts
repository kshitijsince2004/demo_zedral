import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./tests/globalSetupDb.ts'],
    setupFiles: ['./tests/setupIntegration.ts'],
    include: [
      'tests/integration/**/*.test.ts',
      'tests/architecture/tenantIsolation.test.ts',
      'tests/platform-security.test.ts',
      'tests/platform-config-authz.test.ts',
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
    ],
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    testTimeout: 15000,
  },
});
