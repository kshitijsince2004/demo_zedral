import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

describe('DPR stub route hardening', () => {
  it('does not mount /dpr stub router in server entry', () => {
    const indexSrc = fs.readFileSync(path.join(serverSrc, 'index.ts'), 'utf8');
    expect(indexSrc).not.toMatch(/app\.use\(['"]\/dpr['"]/);
    expect(indexSrc).not.toMatch(/from ['"].*dpr\/routes['"]/);
  });

  it('does not ship a /dpr HTTP router module', () => {
    expect(fs.existsSync(path.join(serverSrc, 'dpr/routes/index.ts'))).toBe(false);
  });
});
