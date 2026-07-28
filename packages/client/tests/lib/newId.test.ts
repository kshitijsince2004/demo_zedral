import { afterEach, describe, expect, it } from 'vitest';
import { isUuid, newId } from '../../src/lib/newId';

describe('newId', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
    });
  });

  it('returns a v4 UUID', () => {
    expect(isUuid(newId())).toBe(true);
  });

  it('falls back when randomUUID is missing', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 17 + 3) & 0xff;
          return bytes;
        },
      },
      configurable: true,
    });

    expect(isUuid(newId())).toBe(true);
  });

  it('falls back when crypto is unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
    });

    expect(isUuid(newId())).toBe(true);
  });
});
