import { describe, expect, it } from 'vitest';
import {
  formatActiveProcessType,
  formatOrderProcessLabel,
  formatProcessFilterLabel,
} from '../src/lib/orderLabels';

describe('formatActiveProcessType', () => {
  it('labels CRM and overlay process types for MH tiles', () => {
    expect(formatActiveProcessType('ROLLING')).toBe('Rolling');
    expect(formatActiveProcessType('SKIN_PASS')).toBe('Skin Pass');
    expect(formatActiveProcessType('MANUAL_REROLL')).toBe('Re-Rolling');
    expect(formatActiveProcessType('REWINDING')).toBe('Rewinding');
    expect(formatActiveProcessType('RWD')).toBe('Rewinding');
    expect(formatActiveProcessType(undefined)).toBeUndefined();
  });
});

describe('formatProcessFilterLabel', () => {
  it('labels history / process filter pills', () => {
    expect(formatProcessFilterLabel('ALL')).toBe('All Processes');
    expect(formatProcessFilterLabel('ROLLING')).toBe('Rolling');
    expect(formatProcessFilterLabel('SKIN_PASS')).toBe('Skin Pass');
    expect(formatProcessFilterLabel('MANUAL_REROLL')).toBe('Manual Re-Rolling');
  });
});

describe('formatOrderProcessLabel', () => {
  it('maps queue sub_process including rewinding', () => {
    expect(formatOrderProcessLabel('SKIN_PASS')).toBe('Skin Pass');
    expect(formatOrderProcessLabel('ROLLING')).toBe('Rolling');
    expect(formatOrderProcessLabel('REWINDING')).toBe('Rewinding');
    expect(formatOrderProcessLabel('MANUAL_REROLL')).toBe('Re-Rolling');
    expect(formatOrderProcessLabel(undefined, 'Cold Rolling')).toBe('Cold Rolling');
    expect(formatOrderProcessLabel(null)).toBe('—');
  });
});
