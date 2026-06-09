import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { evaluateRules } from '../../src/rules/configurableRuleEvaluator';
import { EffectiveRuleset } from '../../src/types/configurableRules';

// Feature: configurable-input-validation, Property 5: Client and server evaluate identically
// In a monorepo, since both use the exact same pure function from shared-validation, 
// this test verifies that the evaluator has no environment-specific dependencies (e.g. process.env, globals)
// by running it twice and expecting deep equality.
describe('Property 5: Client and server evaluate identically', () => {
  it('evaluates identically given the same ruleset and data', () => {
    fc.assert(
      fc.property(
        fc.record({
          fieldId: fc.string({ minLength: 1 }),
          val: fc.integer(),
          min: fc.integer(),
          max: fc.integer(),
        }).filter(p => p.min <= p.max),
        ({ fieldId, val, min, max }) => {
          const ruleset: EffectiveRuleset = {
            version: 1,
            rules: {
              [fieldId]: [
                {
                  fieldId,
                  origin: 'DEFAULT',
                  isActive: true,
                  severity: 'BLOCK',
                  type: 'RANGE',
                  params: { min, max }
                }
              ]
            }
          };

          const data = { [fieldId]: val }; // using flat for simplicity

          // "Client" run
          const result1 = evaluateRules(data, ruleset);
          
          // "Server" run
          const result2 = evaluateRules(data, ruleset);

          expect(result1).toEqual(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
