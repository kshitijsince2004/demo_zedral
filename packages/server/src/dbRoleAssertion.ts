import { sql } from 'kysely';
import { db } from './db';
import { isProductionRuntime } from './config/envValidation';

export interface DatabaseRoleInfo {
  currentUser: string;
  isSuperuser: boolean;
  bypassRls: boolean;
}

/** Inspect the runtime DB role — used at startup and in isolation tests. */
export async function getDatabaseRoleInfo(): Promise<DatabaseRoleInfo> {
  const result = await sql<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>`
    SELECT r.rolname AS current_user, r.rolsuper, r.rolbypassrls
    FROM pg_roles r
    WHERE r.rolname = current_user
  `.execute(db);

  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to resolve current PostgreSQL role');
  }

  return {
    currentUser: row.current_user,
    isSuperuser: row.rolsuper,
    bypassRls: row.rolbypassrls,
  };
}

/** Fail fast in production when the app connects with a role that bypasses RLS. */
export async function assertDatabaseRoleAtStartup(): Promise<void> {
  if (!isProductionRuntime()) return;

  const role = await getDatabaseRoleInfo();
  const expected = process.env.DB_APP_USER || 'm1_app';
  if (role.currentUser !== expected) {
    throw new Error(
      `Production startup blocked: connected as "${role.currentUser}" but expected "${expected}" (RLS app role). Check DATABASE_URL / entrypoint restore.`,
    );
  }
  if (role.isSuperuser || role.bypassRls) {
    throw new Error(
      `Production startup blocked: database role "${role.currentUser}" bypasses RLS (rolsuper=${role.isSuperuser}, rolbypassrls=${role.bypassRls}). Use m1_app (NOBYPASSRLS) for runtime connections.`,
    );
  }
}
