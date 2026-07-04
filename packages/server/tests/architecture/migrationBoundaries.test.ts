import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const migrationsDir = path.join(repoRoot, 'packages/server/migrations');
const allowedSchemas = new Set(['public', 'audit', 'canon', 'security', 'txn', 'planning', 'coil', 'master', 'config', 'dpr']);
const ignoredTemplateOwners = new Set(['table', 'app', 'information_schema', 'pg_catalog']);
const schemaReferencePatterns = [
  /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|VIEW|SEQUENCE|FUNCTION|TRIGGER|POLICY)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([a-z][a-z0-9_]*)\./gi,
  /\bCREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z][a-z0-9_]*)\b/gi,
  /\bREFERENCES\s+([a-z][a-z0-9_]*)\./gi,
  /\bIN\s+SCHEMA\s+([a-z][a-z0-9_]*)\b/gi,
  /\bON\s+SCHEMA\s+([a-z][a-z0-9_]*)\b/gi,
];

function readMigrations(): Array<{ file: string; content: string }> {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({ file, content: fs.readFileSync(path.join(migrationsDir, file), 'utf8') }));
}

function extractSql(content: string): string {
  const sqlBlocks = Array.from(content.matchAll(/pgm\.sql\(`([\s\S]*?)`\)/g), (match) => match[1]);
  return sqlBlocks.join('\n').replace(/--.*$/gm, '');
}

function extractNodePgMigrateObjectSchemas(content: string): string[] {
  return Array.from(content.matchAll(/\bschema:\s*['"]([a-z][a-z0-9_]*)['"]/gi), (match) => match[1]);
}

describe('D12 migration boundary governance', () => {
  it('keeps schema-qualified migration DDL within allowed M1/platform schemas', () => {
    for (const migration of readMigrations()) {
      const sql = extractSql(migration.content);
      const schemaReferences = schemaReferencePatterns.flatMap((pattern) =>
        Array.from(sql.matchAll(pattern), (match) => match[1]),
      ).concat(extractNodePgMigrateObjectSchemas(migration.content));
      for (const schema of schemaReferences) {
        if (ignoredTemplateOwners.has(schema)) continue;
        expect(allowedSchemas.has(schema), `${migration.file} references non-owned schema ${schema}`).toBe(true);
      }
    }
  });

  it('keeps module role grants constrained to owned and canonical schemas', () => {
    const roleMigration = fs.readFileSync(
      path.join(migrationsDir, '1908000000000_d12_role_schema_isolation.js'),
      'utf8',
    );
    expect(roleMigration).toContain('zedral_m1_rw');
    expect(roleMigration).toContain('txn, planning, coil, master, config, dpr, canon');
    expect(roleMigration).not.toMatch(/\b(?:maint|plan|oee|yield_|qual|energy)\./i);
  });
});
