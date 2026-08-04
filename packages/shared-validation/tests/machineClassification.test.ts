import { describe, it, expect } from 'vitest';
import {
  matchesMachineClassification,
  parseMachineClassification,
  serializeMachineClassification,
} from '../src/utils/machineClassification';

describe('machineClassification', () => {
  it('serializes and parses tokens', () => {
    expect(serializeMachineClassification(['pkl', 'HRS', 'pkl'])).toBe('PKL,HRS');
    expect(parseMachineClassification('PKL, HRS')).toEqual(['PKL', 'HRS']);
  });

  it('treats empty classification as all machines', () => {
    expect(matchesMachineClassification(null, 'PKL')).toBe(true);
    expect(matchesMachineClassification('', 'HRS')).toBe(true);
  });

  it('matches exact and multi-token assignments', () => {
    expect(matchesMachineClassification('PKL', 'PKL')).toBe(true);
    expect(matchesMachineClassification('PKL', 'HRS')).toBe(false);
    expect(matchesMachineClassification('PKL,HRS', 'HRS')).toBe(true);
  });

  it('aliases rolling mills with CRM6', () => {
    expect(matchesMachineClassification('CRM6', '6HI')).toBe(true);
    expect(matchesMachineClassification('CRM6', '4HI')).toBe(true);
    expect(matchesMachineClassification('6HI', 'CRM6')).toBe(true);
    expect(matchesMachineClassification('PKL', '6HI')).toBe(false);
  });
});
