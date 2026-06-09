import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeEffectiveRuleset } from '../../src/rules/configurableRuleEvaluator';
import { ValidationRule } from '../../src/types/configurableRules';

// Feature: configurable-input-validation, Property 3: Effective ruleset resolution
describe('Property 3: Effective ruleset resolution', () => {
  it('prefers active CONFIGURER rules over DEFAULT rules per field and type', () => {
    fc.assert(
      fc.property(
        fc.record({
          fieldId: fc.string({ minLength: 1 }),
          type: fc.constantFrom('RANGE' as const, 'STEP' as const, 'MANDATORY' as const),
          hasDefault: fc.boolean(),
          hasActiveDefault: fc.boolean(),
          hasConfigurer: fc.boolean(),
          hasActiveConfigurer: fc.boolean(),
        }),
        ({ fieldId, type, hasDefault, hasActiveDefault, hasConfigurer, hasActiveConfigurer }) => {
          const rules: ValidationRule[] = [];
          if (hasDefault) {
            rules.push({
              fieldId,
              origin: 'DEFAULT',
              isActive: hasActiveDefault,
              severity: 'BLOCK',
              type,
              params: {} as any,
            });
          }
          if (hasConfigurer) {
            rules.push({
              fieldId,
              origin: 'CONFIGURER',
              isActive: hasActiveConfigurer,
              severity: 'WARN',
              type,
              params: {} as any,
            });
          }

          const effective = computeEffectiveRuleset(rules, 1);
          const fieldRules = effective.rules[fieldId] || [];
          const effectiveRule = fieldRules.find(r => r.type === type);

          if (hasConfigurer && hasActiveConfigurer) {
            expect(effectiveRule).toBeDefined();
            expect(effectiveRule?.origin).toBe('CONFIGURER');
          } else if (hasDefault && hasActiveDefault) {
            expect(effectiveRule).toBeDefined();
            expect(effectiveRule?.origin).toBe('DEFAULT');
          } else {
            expect(effectiveRule).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
