import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { evaluateField, evaluateRules } from '../../src/rules/configurableRuleEvaluator';
import { ValidationRule, EffectiveRuleset } from '../../src/types/configurableRules';

// Feature: configurable-input-validation, Property 4: Evaluator correctness and BLOCK enforcement
describe('Property 4: Evaluator correctness and BLOCK enforcement', () => {
  it('correctly evaluates RANGE rules', () => {
    fc.assert(
      fc.property(
        fc.record({
          val: fc.double({ min: -1000, max: 1000 }),
          min: fc.double({ min: -1000, max: 1000 }),
          max: fc.double({ min: -1000, max: 1000 }),
        }).filter(p => p.min <= p.max),
        ({ val, min, max }) => {
          const rule: ValidationRule = {
            fieldId: 'test',
            origin: 'DEFAULT',
            isActive: true,
            severity: 'BLOCK',
            type: 'RANGE',
            params: { min, max }
          };
          const errors = evaluateField(val, [rule]);
          const expectedBreach = val < min || val > max;
          expect(errors.length > 0).toBe(expectedBreach);
          if (expectedBreach) {
            expect(errors[0].severity).toBe('BLOCK');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('any BLOCK breach makes evaluateRules return isValid=false', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (hasBlockBreach) => {
          const rule: ValidationRule = {
            fieldId: 'some.field',
            origin: 'DEFAULT',
            isActive: true,
            severity: hasBlockBreach ? 'BLOCK' : 'WARN',
            type: 'RANGE',
            params: { min: 10, max: 20 }
          };
          const effectiveRuleset: EffectiveRuleset = {
            rules: { 'some.field': [rule] },
            version: 1
          };
          
          const result = evaluateRules({ some: { field: 5 } }, effectiveRuleset);
          
          expect(result.isValid).toBe(!hasBlockBreach);
          if (hasBlockBreach) {
            expect(result.errors.length).toBeGreaterThan(0);
          } else {
            expect(result.warnings.length).toBeGreaterThan(0);
            expect(result.errors.length).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
