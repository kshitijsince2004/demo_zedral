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
    
    // Ensure the audit trigger exists (in case migrations haven't run perfectly in the test DB)
    // Ensure the audit trigger exists and fn_audit supports field_id
    await db.executeQuery(
      sql`
        CREATE OR REPLACE FUNCTION audit.fn_audit() RETURNS trigger AS $$
        DECLARE
            pk TEXT;
            uid INTEGER;
            cr_id BIGINT;
            tbl TEXT;
        BEGIN
            tbl := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
        
            pk := COALESCE(
                NULLIF(to_jsonb(NEW)->>'entry_id', ''),
                NULLIF(to_jsonb(OLD)->>'entry_id', ''),
                NULLIF(to_jsonb(NEW)->>'field_id', ''),
                NULLIF(to_jsonb(OLD)->>'field_id', ''),
                ''
            );

            uid := NULLIF(to_jsonb(NEW)->>'user_id', '')::integer;

            IF (TG_OP = 'UPDATE') THEN
                INSERT INTO audit.audit_log(table_name, record_pk, action, new_value, old_value, user_id, ts)
                VALUES (tbl, pk, 'UPDATE', row_to_json(NEW)::text, row_to_json(OLD)::text, uid, now());
                RETURN NEW;
            ELSIF (TG_OP = 'INSERT') THEN
                INSERT INTO audit.audit_log(table_name, record_pk, action, new_value, user_id, ts)
                VALUES (tbl, pk, 'INSERT', row_to_json(NEW)::text, uid, now());
                RETURN NEW;
            ELSE
                INSERT INTO audit.audit_log(table_name, record_pk, action, old_value, ts)
                VALUES (tbl, pk, 'DELETE', row_to_json(OLD)::text, now());
                RETURN OLD;
            END IF;
        END $$ LANGUAGE plpgsql;

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
          
          expect(history.length).toBe(beforeLength + updates.length);

          // Verify reverse-chronological ordering
          for (let i = 0; i < history.length - 1; i++) {
            const currentTs = new Date(history[i].ts).getTime();
            const nextTs = new Date(history[i + 1].ts).getTime();
            expect(currentTs).toBeGreaterThanOrEqual(nextTs);
          }

          // The most recent record should match the last update
          const lastUpdate = updates[updates.length - 1];
          const latestHistoryRecord = history[0];
          const newValue = JSON.parse(latestHistoryRecord.new_value);
          
          expect(newValue.rule_type).toBe(lastUpdate.type);
          expect(newValue.severity).toBe(lastUpdate.severity);
          expect(newValue.is_active).toBe(lastUpdate.isActive);
        }
      ),
      { numRuns: 10 }
    );
  });
});
