import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateRuleDefinition } from '../../src/rules/configurableRuleEvaluator';
import { ValidationRule } from '../../src/types/configurableRules';

// Feature: configurable-input-validation, Property 1: Rule definition validity
describe('Property 1: Rule definition validity', () => {
  it('accepts valid rule definitions', () => {
    fc.assert(
      fc.property(
        fc.record({
          fieldId: fc.string({ minLength: 1 }),
          severity: fc.constantFrom('BLOCK' as const, 'WARN' as const),
          origin: fc.constantFrom('DEFAULT' as const, 'CONFIGURER' as const),
          isActive: fc.boolean(),
          type: fc.constant('RANGE'),
          params: fc.record({
            min: fc.integer(),
            max: fc.integer(),
          }).filter(p => p.min <= p.max)
        }),
        (rulePartial) => {
          const rule: ValidationRule = rulePartial as any;
          expect(validateRuleDefinition(rule)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects RANGE rule if min > max', () => {
    fc.assert(
      fc.property(
        fc.record({
          fieldId: fc.string(),
          severity: fc.constant('BLOCK' as const),
          origin: fc.constant('DEFAULT' as const),
          isActive: fc.boolean(),
          type: fc.constant('RANGE'),
          params: fc.record({
            min: fc.integer(),
            max: fc.integer(),
          }).filter(p => p.min > p.max)
        }),
        (rulePartial) => {
          const rule: ValidationRule = rulePartial as any;
          expect(validateRuleDefinition(rule)).toBe('params.min');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects ALLOWED_VALUES rule if empty', () => {
    fc.assert(
      fc.property(
        fc.record({
          fieldId: fc.string(),
          severity: fc.constant('BLOCK' as const),
          origin: fc.constant('DEFAULT' as const),
          isActive: fc.boolean(),
          type: fc.constant('ALLOWED_VALUES'),
          params: fc.record({ values: fc.constant([]) })
        }),
        (rulePartial) => {
          const rule: ValidationRule = rulePartial as any;
          expect(validateRuleDefinition(rule)).toBe('params.values');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects STEP rule if step <= 0', () => {
    fc.assert(
      fc.property(
        fc.record({
          fieldId: fc.string(),
          severity: fc.constant('BLOCK' as const),
          origin: fc.constant('DEFAULT' as const),
          isActive: fc.boolean(),
          type: fc.constant('STEP'),
          params: fc.record({ step: fc.integer({ max: 0 }) })
        }),
        (rulePartial) => {
          const rule: ValidationRule = rulePartial as any;
          expect(validateRuleDefinition(rule)).toBe('params.step');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects PATTERN rule if invalid regex', () => {
    const invalidPatterns = ['[', '(', '*', '+', '?', '\\'];
    fc.assert(
      fc.property(
        fc.record({
          fieldId: fc.string(),
          severity: fc.constant('BLOCK' as const),
          origin: fc.constant('DEFAULT' as const),
          isActive: fc.boolean(),
          type: fc.constant('PATTERN'),
          params: fc.record({ pattern: fc.constantFrom(...invalidPatterns) })
        }),
        (rulePartial) => {
          const rule: ValidationRule = rulePartial as any;
          expect(validateRuleDefinition(rule)).toBe('params.pattern');
        }
      ),
      { numRuns: 100 }
    );
  });
});
