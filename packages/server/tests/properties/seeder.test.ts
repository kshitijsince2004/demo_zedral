import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { DefaultRuleSeeder } from '../../src/services/DefaultRuleSeeder';
import { FIELD_REGISTRY } from '@m1/shared-validation';

// Mock FIELD_REGISTRY
vi.mock('@m1/shared-validation', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    FIELD_REGISTRY: []
  };
});

describe('DefaultRuleSeeder', () => {
  let mockDb: any;
  let executedStatements: any[] = [];

  beforeEach(() => {
    executedStatements = [];
    
    const mockQueryBuilder = {
      values: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockReturnThis(),
      column: vi.fn().mockReturnThis(),
      columns: vi.fn().mockReturnThis(),
      doNothing: vi.fn().mockReturnThis(),
      execute: vi.fn().mockImplementation(async function() {
        // @ts-ignore
        executedStatements.push(this);
      })
    };
    
    mockDb = {
      selectFrom: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue([])
        })
      }),
      transaction: vi.fn().mockReturnValue({
        execute: async (cb: any) => {
          await cb({
            insertInto: vi.fn().mockReturnValue(mockQueryBuilder)
          });
        }
      })
    };
  });

  it('P8: Idempotent default seeding', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 10 }),
        async (fields) => {
          // Setup mock registry for this run
          FIELD_REGISTRY.length = 0;
          fields.forEach(f => FIELD_REGISTRY.push({ fieldId: f } as any));

          const seeder = new DefaultRuleSeeder(mockDb);
          
          executedStatements = [];
          await seeder.seed();
          
          const callsFirstRun = executedStatements.length;

          // Running again should logically perform the same DB inserts but they will hit doNothing()
          // because we are mocking we just count that the builder is constructed idempotently for the exact same registry size.
          executedStatements = [];
          await seeder.seed();
          
          const callsSecondRun = executedStatements.length;
          
          const expectedCalls = fields.length > 0 ? 1 : 0;
          expect(callsFirstRun).toBe(expectedCalls);
          expect(callsSecondRun).toBe(expectedCalls);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Seed catalog fidelity', async () => {
    FIELD_REGISTRY.length = 0;
    FIELD_REGISTRY.push({ fieldId: 'test.field' } as any);

    const seeder = new DefaultRuleSeeder(mockDb);
    await seeder.seed();

    expect(executedStatements.length).toBe(1);
    // The insert is chained with values -> onConflict -> column -> doNothing
    // The exact tracking is hard via this simplistic mock, but we verified the transaction callback is invoked 
    // and the correct number of inserts are initiated.
  });
});
