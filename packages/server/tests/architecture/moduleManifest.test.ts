import { describe, expect, it } from 'vitest';
import { m1ManifestMeta } from '@zedral/m1-collection';
import { buildModuleRegistry } from '../../src/modules/registerModules';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../../..');

describe('D12 module manifest governance', () => {
  it('keeps M1 manifest metadata complete and dependency-free', () => {
    expect(m1ManifestMeta).toMatchObject({
      code: 'M1',
      name: 'Digital Data Collection',
      dbSchema: 'txn',
      featureFlag: 'module.m1_collection',
      mountPath: '/',
      migrationsPath: 'packages/server/migrations/modules/m1',
    });
    expect(m1ManifestMeta.dependsOn).toEqual([]);
    expect(m1ManifestMeta.consumesEvents).toEqual([]);
    expect(m1ManifestMeta.producesEvents).toEqual([
      'shift.closed',
      'downtime.logged',
      'production.counted',
      'production.captured',
      'defect.logged',
    ]);
  });

  it('registers M1 through the module registry with no module dependencies', () => {
    const registry = buildModuleRegistry();
    const manifests = registry.list();
    expect(manifests.map((manifest) => manifest.code)).toEqual(['M1']);
    for (const manifest of manifests) {
      expect(manifest.dependsOn).toEqual([]);
      expect(manifest.createRouter).toBeTypeOf('function');
      expect(manifest.getSchedulers()).toEqual([]);
    }
  });

  it('keeps declared migration paths aligned with repository layout', () => {
    const registry = buildModuleRegistry();
    for (const manifest of registry.list()) {
      const migrationPath = path.join(repoRoot, manifest.migrationsPath);
      expect(fs.existsSync(migrationPath), `${manifest.code} migrationsPath must exist: ${manifest.migrationsPath}`).toBe(true);
    }
  });
});
