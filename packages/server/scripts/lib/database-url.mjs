/**
 * Resolve Postgres URL from DATABASE_URL or Docker-style DB_* variables.
 * Backend containers use DB_HOST=db; local dev defaults to localhost.
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
