import { beforeAll } from 'vitest';
import { ensureIntegrationTestFixtures } from './helpers/integrationFixtures';

beforeAll(async () => {
  const dbAvailable =
    process.env.VITEST_DB_AVAILABLE === '1' || process.env.GITHUB_ACTIONS === 'true';
  if (!dbAvailable) {
    throw new Error(
      'SKIP_INTEGRATION: PostgreSQL is not available. Start docker-compose or set DATABASE_URL.',
    );
  }

  await ensureIntegrationTestFixtures();
});
