import { describe, it, expect } from 'vitest';
import { FIELD_REGISTRY, isKnownField, getFieldDescriptor } from '../src/rules/fieldRegistry';

describe('Field_Registry', () => {
  it('derives field registry from existing process schemas', () => {
    expect(FIELD_REGISTRY.length).toBeGreaterThan(0);
    
    // Check known fields
    expect(isKnownField('PKL.lineSpeedMpm')).toBe(true);
    expect(isKnownField('HRS.nominalWidthMm')).toBe(true);
    expect(isKnownField('ANN.oxygenPct')).toBe(true);

    const desc = getFieldDescriptor('PKL.lineSpeedMpm');
    expect(desc).toBeDefined();
    expect(desc?.process).toBe('PKL');
    expect(desc?.property).toBe('lineSpeedMpm');
    expect(desc?.dataType).toBe('number');
    expect(desc?.unit).toBe('m/min');
  });

  it('rejects unknown fields', () => {
    expect(isKnownField('UNKNOWN.field')).toBe(false);
    expect(getFieldDescriptor('UNKNOWN.field')).toBeUndefined();
  });
});
