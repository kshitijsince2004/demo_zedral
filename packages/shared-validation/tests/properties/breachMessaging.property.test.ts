import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { describeBreach } from '../../src/rules/configurableRuleEvaluator';
import { ValidationRule } from '../../src/types/configurableRules';

// Feature: configurable-input-validation, Property 10: Plain-language, severity-appropriate breach messages
describe('Property 10: Plain-language, severity-appropriate breach messages', () => {
  it('includes appropriate severity wording and condition description', () => {
    fc.assert(
      fc.property(
        fc.record({
          severity: fc.constantFrom('BLOCK' as const, 'WARN' as const),
          type: fc.constantFrom('MANDATORY' as const, 'RANGE' as const, 'STEP' as const),
        }),
        ({ severity, type }) => {
          const rule: ValidationRule = {
            fieldId: 'test',
            origin: 'DEFAULT',
            isActive: true,
            severity,
            type,
            params: type === 'RANGE' ? { min: 1, max: 10 } :
                    type === 'STEP' ? { step: 5 } :
                    { mandatory: true }
          } as any;

          const message = describeBreach(rule);

          // Verify plain language (no raw JSON/code)
          expect(message).not.toContain('{');
          expect(message).not.toContain('}');

          // Verify severity wording
          if (severity === 'BLOCK') {
            expect(message).toContain('Correction is required');
            expect(message).not.toContain('override');
          } else {
            expect(message).toContain('override reason');
            expect(message).not.toContain('Correction is required');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
