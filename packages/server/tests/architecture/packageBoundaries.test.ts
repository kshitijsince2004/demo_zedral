import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;
}

function collectFiles(directory: string, extension: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(fullPath, extension);
    return entry.name.endsWith(extension) ? [fullPath] : [];
  });
}

describe('D12 package boundary governance', () => {
  it('declares D12 workspace packages and root arch check scripts', () => {
    const rootPackage = readJson<{
      workspaces: string[];
      scripts: Record<string, string>;
    }>('package.json');
    expect(rootPackage.workspaces).toContain('packages/*');
    expect(rootPackage.workspaces).toContain('packages/modules/*');
    expect(rootPackage.scripts['arch:deps']).toContain('depcruise');
    expect(rootPackage.scripts['arch:test']).toContain('test:arch');
    expect(rootPackage.scripts['arch:check']).toContain('arch:deps');

    const rootTsconfig = readJson<{ references: Array<{ path: string }> }>('tsconfig.json');
    expect(rootTsconfig.references.map((ref) => ref.path)).toEqual([
      'packages/shared-validation',
      'packages/platform',
      'packages/connectors',
      'packages/modules/m1-collection',
      'packages/server',
      'packages/client',
    ]);
  });

  it('keeps connectors as an edge package depending only on platform contracts', () => {
    const connectorPackage = readJson<{
      name: string;
      dependencies?: Record<string, string>;
    }>('packages/connectors/package.json');
    expect(connectorPackage.name).toBe('@zedral/connectors');
    expect(Object.keys(connectorPackage.dependencies ?? {})).toEqual(['@zedral/platform']);
    expect(fs.existsSync(path.join(repoRoot, 'deploy/connectors/Dockerfile'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'deploy/connectors/README.md'))).toBe(true);
  });

  it('keeps production Docker builds aligned with D12 workspace packages', () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('packages/platform/package.json');
    expect(dockerfile).toContain('packages/connectors/package.json');
    expect(dockerfile).toContain('packages/modules/m1-collection/package.json');
    // Backend copies pruned workspace trees (includes dist/) from prod-deps — not
    // per-path COPY …/dist from builder (that pattern broke prod zod resolution).
    expect(dockerfile).toContain('FROM builder AS prod-deps');
    expect(dockerfile).toContain('COPY --from=prod-deps /app/packages/platform ./packages/platform');
    expect(dockerfile).toContain(
      'COPY --from=prod-deps /app/packages/modules/m1-collection ./packages/modules/m1-collection',
    );
    expect(dockerfile).toContain('COPY --from=prod-deps /app/packages/server ./packages/server');
  });

  it('does not introduce static imports from M1 server modules into other module packages', () => {
    const moduleFiles = collectFiles(path.join(repoRoot, 'packages/server/src/modules'), '.ts');
    for (const file of moduleFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content, `${path.relative(repoRoot, file)} must not import M2/M3/M4 modules`).not.toMatch(
        /from\s+['"][^'"]*(?:m2|m3|m4)[^'"]*['"]/i,
      );
    }
  });
});
