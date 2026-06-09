import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin } from '../src/services/pinService';

describe('UserService PIN helpers', () => {
  it('hashes and verifies a 4-digit PIN for new users', () => {
    const stored = hashPin('4321');
    expect(verifyPin('4321', stored)).toBe(true);
    expect(verifyPin('0000', stored)).toBe(false);
  });
});
