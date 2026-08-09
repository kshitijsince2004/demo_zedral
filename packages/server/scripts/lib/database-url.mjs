/**
 * Resolve Postgres URL from DATABASE_URL or Docker-style DB_* variables.
 * Backend runtime uses DATABASE_URL=m1_app (RLS). Seeds/migrations must not.
 */
export function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const user = process.env.DB_USER || 'm1_user';
  const password = process.env.DB_PASSWORD || 'm1_password';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const db = process.env.DB_NAME || 'm1_db';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

/**
 * Owner/bootstrap URL for seeds + privileged scripts (bypass RLS).
 * Prefer MIGRATE_DATABASE_URL (m1_user) over DATABASE_URL (m1_app in prod).
 * Local: no MIGRATE_ → DB_* / resolveDatabaseUrl() defaults to m1_user.
 */
export function resolveOwnerDatabaseUrl() {
  const migrate = process.env.MIGRATE_DATABASE_URL?.trim();
  if (migrate) return migrate;

  // Compose injects DB_USER/DB_PASSWORD as the bootstrap owner even when
  // DATABASE_URL is the RLS app role — prefer owner for privileged writes.
  if (process.env.DB_USER && process.env.DB_PASSWORD) {
    const user = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const host = process.env.DB_HOST || 'db';
    const port = process.env.DB_PORT || '5432';
    const db = process.env.DB_NAME || 'm1_db';
    return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  }

  return resolveDatabaseUrl();
}
