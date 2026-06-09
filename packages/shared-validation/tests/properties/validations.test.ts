import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { UserRole } from '../../src/types';
import { HRSSchema, CRMSchema } from '../../src/rules/fieldRules';
import { canOverride } from '../../src/rules/overrides';
import { validateShiftLogSubmission } from '../../src/rules/shiftLogRules';

describe('Property Tests: Validations and Overrides', () => {

  // Property 4: Cross-field validation enforcement
  describe('Property 4: Cross-field enforcement', () => {
    it('HRS: should reject if actualWidthMm > nominalWidthMm', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 2000, noNaN: true }), // nominal
          fc.double({ min: 100, max: 2500, noNaN: true }), // actual
          (nominalWidthMm, actualWidthMm) => {
            const entry = {
              id: 'test',
              shiftLogId: 'sl1',
              coilNo: 'C001',
              startTime: new Date(),
              endTime: new Date(),
              weightMt: 10,
              scrapMt: 1,
              nominalWidthMm,
              actualWidthMm,
              nominalThkMm: 5,
              slitSlots: [],
            };

            const result = HRSSchema.safeParse(entry);
            if (actualWidthMm > nominalWidthMm) {
              expect(result.success).toBe(false);
              if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('actualWidthMm'));
                expect(issue).toBeDefined();
              }
            } else {
              expect(result.success).toBe(true);
            }
          }
        )
      );
    });

    it('CRM: should reject if outputThkMm >= inputThkMm', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.1, max: 10, noNaN: true }), // input
          fc.double({ min: 0.1, max: 10, noNaN: true }), // output
          (inputThkMm, outputThkMm) => {
            const entry = {
              id: 'test',
              shiftLogId: 'sl1',
              coilNo: 'C001',
              startTime: new Date(),
              endTime: new Date(),
              weightMt: 10,
              widthMm: 1000,
              inputThkMm,
              outputThkMm,
              scrapMt: 0,
            };

            const result = CRMSchema.safeParse(entry);
            if (outputThkMm >= inputThkMm) {
              expect(result.success).toBe(false);
              if (!result.success) {
                const issue = result.error.issues.find(i => i.path.includes('outputThkMm'));
                expect(issue).toBeDefined();
              }
            } else {
              expect(result.success).toBe(true);
            }
          }
        )
      );
    });
  });

  // Property 20: Validation override governance
  describe('Property 20: Override Governance', () => {
    it('should reject overrides on BLOCK severity', () => {
      fc.assert(
        fc.property(
          fc.array(fc.constant(UserRole.SUPERVISOR), { minLength: 1 }),
          (roles) => {
            const result = {
              isValid: false,
              errors: [{ field: 'actualWidthMm', message: 'Block issue', severity: 'BLOCK' as const }],
              warnings: [],
            };
            const overrides = [{ field: 'actualWidthMm', reason: 'Because' }];
            const allowed = canOverride(result, overrides, roles);
            expect(allowed).toBe(false);
          }
        )
      );
    });

    it('should allow overrides on WARN severity by SUPERVISOR/ADMIN with reason', () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(UserRole.SUPERVISOR, UserRole.ADMIN, UserRole.PLANT_HEAD), { minLength: 1 }),
          fc.string({ minLength: 1 }),
          (roles, reason) => {
            const result = {
              isValid: true,
              errors: [],
              warnings: [{ field: 'hardnessVpn', message: 'Out of spec', ruleId: 'r1' }],
            };
            const overrides = [{ field: 'hardnessVpn', reason }];
            const allowed = canOverride(result, overrides, roles);
            expect(allowed).toBe(true);
          }
        )
      );
    });

    it('should reject overrides on WARN severity without reason or wrong role', () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(UserRole.OPERATOR), { minLength: 1 }),
          (roles) => {
            const result = {
              isValid: true,
              errors: [],
              warnings: [{ field: 'hardnessVpn', message: 'Out of spec', ruleId: 'r1' }],
            };
            const overrides = [{ field: 'hardnessVpn', reason: 'Because' }];
            const allowed = canOverride(result, overrides, roles);
            expect(allowed).toBe(false); // Wrong role
          }
        )
      );
    });
  });

  // Property 30: Submission gate enforcement
  describe('Property 30: Submission Gate', () => {
    it('should aggregate errors and block submission if child entries are invalid', () => {
      const shiftLog = {
        id: 'log1',
        processLine: 'CRM',
        productionDate: new Date(),
        shiftCode: 'A',
        millType: '4HI',
        state: 'DRAFT',
        supervisorId: 'sup1',
      };

      const entries = [
        {
          id: 'test',
          shiftLogId: 'log1',
          coilNo: 'C001',
          startTime: new Date(),
          endTime: new Date(),
          weightMt: 10,
          widthMm: 1000,
          inputThkMm: 2,
          outputThkMm: 5, // Invalid: output > input
          scrapMt: 0,
        },
      ];

      const result = validateShiftLogSubmission(shiftLog, entries);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.field.includes('outputThkMm'))).toBe(true);
    });
  });

});
