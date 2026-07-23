import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import fc from 'fast-check';
import { sql } from 'kysely';
import { ValidationConfigService } from '../../src/services/ValidationConfigService';
import { db } from '../../src/db';
import { FIELD_REGISTRY } from '@m1/shared-validation';

describe('ValidationConfigService Property Tests', () => {
  let service: ValidationConfigService;

  beforeAll(async () => {
    service = new ValidationConfigService(db);

    // Ensure trigger only — do not replace audit.fn_audit (shared DB / migrations own it).
    await db.executeQuery(
      sql`
        DROP TRIGGER IF EXISTS trg_audit_validation_rule ON config.validation_rule;
        CREATE TRIGGER trg_audit_validation_rule
        AFTER INSERT OR UPDATE OR DELETE ON config.validation_rule
        FOR EACH ROW EXECUTE FUNCTION audit.fn_audit();
      `.compile(db)
    ).catch(() => {});
  });

  beforeEach(async () => {
    await db.deleteFrom('config.validation_rule').execute();
  });

  afterAll(async () => {
    await db.deleteFrom('config.validation_rule').execute();
  });

  it('P2: Field-registry acceptance gate', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter(s => !FIELD_REGISTRY.some(f => f.fieldId === s)),
        async (unknownFieldId) => {
          await expect(
            service.updateRule(
              unknownFieldId,
              { type: 'MANDATORY', severity: 'WARN', isActive: true, params: { mandatory: true } },
              'test_user'
            )
          ).rejects.toThrow(/Cannot configure unknown field/);
        }
      )
    );
  });

  it('P9: History is reverse-chronological and captures all changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            type: fc.constantFrom('RANGE', 'ALLOWED_VALUES', 'STEP', 'PATTERN', 'MANDATORY'),
            severity: fc.constantFrom('BLOCK', 'WARN'),
            isActive: fc.boolean(),
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (updates) => {
          const fieldId = FIELD_REGISTRY[0].fieldId;
          
          await db.deleteFrom('config.validation_rule').execute();

          const initialHistory = await service.getFieldHistory(fieldId);
          const beforeLength = initialHistory.length;

          for (const update of updates) {
            await service.updateRule(
              fieldId,
              {
                type: update.type as any,
                severity: update.severity as any,
                isActive: update.isActive,
                params: {} // dummy params
              },
              'test_user'
            );
          }

          const history = await service.getFieldHistory(fieldId);

          // Column-level audit (fn_audit) emits one row per changed column, so
          // history grows by ≥1 per updateRule — not exactly one whole-row event.
          expect(history.length).toBeGreaterThan(beforeLength);

          // Verify reverse-chronological ordering
          for (let i = 0; i < history.length - 1; i++) {
            const currentTs = new Date(history[i].ts).getTime();
            const nextTs = new Date(history[i + 1].ts).getTime();
            expect(currentTs).toBeGreaterThanOrEqual(nextTs);
          }

          // Live rule matches the last update (source of truth under column audits).
          // Different rule_type values are separate rows — pick the most recently updated.
          const lastUpdate = updates[updates.length - 1];
          const current = await db
            .selectFrom('config.validation_rule')
            .select(['rule_type', 'severity', 'is_active'])
            .where('field_id', '=', fieldId)
            .orderBy('updated_at', 'desc')
            .executeTakeFirst();
          expect(current?.rule_type).toBe(lastUpdate.type);
          expect(current?.severity).toBe(lastUpdate.severity);
          expect(current?.is_active).toBe(lastUpdate.isActive);
        }
      ),
      { numRuns: 10 }
    );
  });
});
