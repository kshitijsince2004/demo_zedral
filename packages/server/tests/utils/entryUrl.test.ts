import { describe, it, expect } from 'vitest';
import { parseProcessCodeFromEntryUrl } from '../../src/utils/entryUrl';

describe('parseProcessCodeFromEntryUrl', () => {
  it('parses lowercase entry paths', () => {
    expect(parseProcessCodeFromEntryUrl('/entries/hrs')).toBe('HRS');
    expect(parseProcessCodeFromEntryUrl('/api/entries/pkl')).toBe('PKL');
  });

  it('returns null for non-entry URLs', () => {
    expect(parseProcessCodeFromEntryUrl('/shift-logs/active/HRS')).toBeNull();
    expect(parseProcessCodeFromEntryUrl('')).toBeNull();
  });
});
