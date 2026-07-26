import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/components/sixHi/weightOcrCapture';

describe('sha256Hex', () => {
  it('hashes known bytes to SHA-256 hex', async () => {
    const bytes = new TextEncoder().encode('zedral-weight');
    const hex = await sha256Hex(bytes);
    expect(hex).toBe('d4ce78fffdd82e97f2de79c6e335dae62edf259ce93ddc7f9cf9900b7ec462c6');
    expect(await sha256Hex(bytes)).toBe(hex);
  });
});
