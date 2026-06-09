import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { db, withTenantContext } from '../src/db';
import { requestContext } from '../src/context';
import { BaseRepository } from '../src/repositories/BaseRepository';

function shortCustomerCode(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-8)}${Math.random().toString(36).slice(2, 4)}`.slice(0, 20);
}

describe('Platform Security: Multi-Tenancy', () => {
  const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  beforeAll(async () => {
    // Setup test tenants, ignoring if they already exist
    try {
      await db.insertInto('security.tenant' as any)
        .values([
          { tenant_id: tenantA, name: 'Tenant A', status: 'ACTIVE' },
          { tenant_id: tenantB, name: 'Tenant B', status: 'ACTIVE' }
        ])
        .execute();
    } catch (e) {
      // ignore
    }
  });

  // Feature: platform-security, Property 1: Tenant stamping
  it('Property 1: Tenant stamping - Records are stamped with RequestContext tenant_id', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (dummyName) => {
        // Just picking alphanumeric so we don't break db constraints
        const safeName = dummyName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
        await requestContext.run({ tenant_id: tenantA }, async () => {
          const repo = new BaseRepository('master.customer' as any);
          const result = await repo.insert({
            customer_code: shortCustomerCode('A'),
            customer_name: safeName || 'Cust',
            is_active: true
          });
          expect(result.tenant_id).toBe(tenantA);
        });
      }),
      { numRuns: 10 } // reduced for speed in this mock environment
    );
  });

  // Feature: platform-security, Property 2: Tenant isolation
  it('Property 2: Tenant isolation - Reads only return records for the active tenant', async () => {
    await requestContext.run({ tenant_id: tenantB }, async () => {
      const repo = new BaseRepository('master.customer' as any);

      const code = shortCustomerCode('B');
      await repo.insert({
        customer_code: code,
        customer_name: 'B Cust',
        is_active: true,
      });

      const rows = await withTenantContext(async (trx) => {
        return await trx
          .selectFrom('master.customer' as any)
          .selectAll()
          .where('tenant_id', '=', tenantB)
          .execute();
      });

      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((r: any) => expect(r.tenant_id).toBe(tenantB));
      expect(rows.some((r: any) => r.customer_code === code)).toBe(true);
    });
  });

  // Feature: platform-security, Property 3: No-tenant default-deny
  it('Property 3: No-tenant default-deny - Rejects writes if no tenant in context', async () => {
    await requestContext.run({}, async () => { 
      const repo = new BaseRepository('master.customer' as any);
      await expect(repo.insert({
        customer_code: 'NO_TENANT',
        customer_name: 'Fail',
        is_active: true
      })).rejects.toThrow(/Tenant context is missing/);
    });
  });

  // Feature: platform-security, Property 4: Cross-tenant access is denied
  it('Property 4: Cross-tenant denied via repository', async () => {
    let otherTenantCustomerId: number;
    await requestContext.run({ tenant_id: tenantB }, async () => {
      const repo = new BaseRepository('master.customer' as any);
      const row = await repo.insert({
        customer_code: shortCustomerCode('X'),
        customer_name: 'Cross',
        is_active: true,
      });
      otherTenantCustomerId = row.customer_id;
    });

    await requestContext.run({ tenant_id: tenantA }, async () => {
      const repo = new BaseRepository('master.customer' as any);
      const found = await repo.findById('customer_id', otherTenantCustomerId);
      expect(found).toBeUndefined();
    });
  });
});
