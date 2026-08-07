import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const serverMigrationsDir = path.join(repoRoot, 'packages/server/migrations');

const platformSchemas = ['canon', 'security', 'audit'] as const;
const m1Schemas = ['txn', 'planning', 'coil', 'master', 'config', 'dpr'] as const;
const forbiddenModuleSchemas = ['maint', 'plan', 'oee', 'yield_', 'qual', 'energy'] as const;

function readMigrationFiles(): Array<{ file: string; content: string }> {
  return fs
    .readdirSync(serverMigrationsDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({
      file,
      content: fs.readFileSync(path.join(serverMigrationsDir, file), 'utf8'),
    }));
}

describe('D12 schema ownership governance', () => {
  it('documents platform and M1-owned schemas without foreign module schemas', () => {
    expect(platformSchemas).toEqual(['canon', 'security', 'audit']);
    expect(m1Schemas).toEqual(['txn', 'planning', 'coil', 'master', 'config', 'dpr']);
    expect(forbiddenModuleSchemas).toEqual(['maint', 'plan', 'oee', 'yield_', 'qual', 'energy']);
  });

  it('prevents M1/server migrations from creating or altering M2-M7 schemas', () => {
    for (const migration of readMigrationFiles()) {
      for (const schema of forbiddenModuleSchemas) {
        const schemaReference = new RegExp(`\\b(?:CREATE\\s+SCHEMA|ALTER\\s+TABLE|CREATE\\s+TABLE|DROP\\s+TABLE)\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?${schema}\\b`, 'i');
        // Require schema.table (e.g. maint.work_order), not prose like "Preventive Maint."
        const qualifiedReference = new RegExp(`\\b${schema}\\.[a-z_][a-z0-9_]*`, 'i');
        expect(
          schemaReference.test(migration.content) || qualifiedReference.test(migration.content),
          `${migration.file} must not touch foreign schema ${schema}`,
        ).toBe(false);
      }
    }
  });

  it('contains the D12 platform and M1 schema role isolation migration', () => {
    const roleMigration = fs.readFileSync(
      path.join(serverMigrationsDir, '1908000000000_d12_role_schema_isolation.js'),
      'utf8',
    );
    expect(roleMigration).toContain('zedral_platform_rw');
    expect(roleMigration).toContain('zedral_m1_rw');
    expect(roleMigration).toContain('zedral_canon_writeback');
    expect(roleMigration).toContain('search_path');
    expect(roleMigration).toContain('REVOKE ALL PRIVILEGES ON SCHEMA');
    expect(roleMigration).toContain('txn, planning, coil, master, config, dpr');
    expect(roleMigration).toContain('security, canon, audit');
    expect(roleMigration).toContain('DROP ROLE IF EXISTS zedral_m1_rw');
    expect(roleMigration).toContain('DROP ROLE IF EXISTS zedral_canon_writeback');
  });
});
