import fc from 'fast-check';
import { ValidationRule, EffectiveRuleset } from '../../src/types/configurableRules';
import { FIELD_REGISTRY } from '../../src/rules/fieldRegistry';

export const genValidRule = (): fc.Arbitrary<ValidationRule> => {
  return fc.record({
    fieldId: fc.constantFrom(...FIELD_REGISTRY.map(f => f.fieldId)),
    origin: fc.constantFrom('DEFAULT' as const, 'CONFIGURER' as const),
    isActive: fc.boolean(),
    severity: fc.constantFrom('BLOCK' as const, 'WARN' as const),
  }).chain((base) => {
    return fc.oneof(
      fc.record({
        ...base,
        type: fc.constant('RANGE' as const),
        params: fc.record({
          min: fc.integer({ min: 1, max: 100 }),
          max: fc.integer({ min: 101, max: 200 }),
        }),
      }),
      fc.record({
        ...base,
        type: fc.constant('STEP' as const),
        params: fc.record({ step: fc.integer({ min: 1, max: 10 }) }),
      }),
      fc.record({
        ...base,
        type: fc.constant('ALLOWED_VALUES' as const),
        params: fc.record({ values: fc.array(fc.string({ minLength: 1 }), { minLength: 1 }) }),
      }),
      fc.record({
        ...base,
        type: fc.constant('MANDATORY' as const),
        params: fc.record({ mandatory: fc.boolean() }),
      }),
      fc.record({
        ...base,
        type: fc.constant('PATTERN' as const),
        params: fc.record({ pattern: fc.constant('^[a-zA-Z]+$') }),
      })
    ) as fc.Arbitrary<ValidationRule>;
  });
};

export const genEffectiveRuleset = (): fc.Arbitrary<EffectiveRuleset> => {
  return fc.record({
    version: fc.integer({ min: 1 }),
    rules: fc.dictionary(
      fc.constantFrom(...FIELD_REGISTRY.map(f => f.fieldId)),
      fc.array(genValidRule(), { minLength: 1, maxLength: 3 })
    )
  });
};
