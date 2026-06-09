import { db } from '../../src/db';

const TEST_USERNAME = 'integration_test_user';
const TEST_EMP_CODE = 'CI-TEST';
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

let integrationTestUserId: number | null = null;

export function getIntegrationTestUserId(): number {
  if (integrationTestUserId === null) {
    throw new Error(
      'Integration test fixtures not initialized — ensure setupIntegration.ts ran beforeAll.',
    );
  }
  return integrationTestUserId;
}

/**
 * Idempotent fixtures for DB-backed integration tests.
 * CI runs migrations only; this ensures import_batch.imported_by FK targets exist.
 */
export async function ensureIntegrationTestFixtures(): Promise<void> {
  if (integrationTestUserId !== null) {
    return;
  }

  const existingUser = await db
    .selectFrom('security.app_user')
    .select('user_id')
    .where('username', '=', TEST_USERNAME)
    .executeTakeFirst();

  if (existingUser) {
    integrationTestUserId = Number(existingUser.user_id);
  } else {
    const inserted = await db
      .insertInto('security.app_user')
      .values({
        username: TEST_USERNAME,
        full_name: 'Integration Test Importer',
        emp_code: TEST_EMP_CODE,
        status: 'ACTIVE',
        tenant_id: DEFAULT_TENANT_ID,
      })
      .returning('user_id')
      .executeTakeFirstOrThrow();
    integrationTestUserId = Number(inserted.user_id);
  }

  await db
    .insertInto('master.customer')
    .values({
      customer_code: 'CUST_TATA',
      customer_name: 'Tata Motors',
      is_active: true,
      tenant_id: DEFAULT_TENANT_ID,
    })
    .onConflict((oc) => oc.column('customer_code').doNothing())
    .execute();

  await db
    .insertInto('master.grade')
    .values({
      grade_code: 'CRCA',
      description: 'Cold Rolled Close Annealed',
      grade_family: 'CRCA',
      is_active: true,
      tenant_id: DEFAULT_TENANT_ID,
    })
    .onConflict((oc) => oc.column('grade_code').doNothing())
    .execute();
}
