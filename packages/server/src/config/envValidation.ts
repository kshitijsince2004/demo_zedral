import { isAuthStrict } from './authConfig';
import { logger } from '../utils/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WEAK_JWT_SECRETS = new Set([
  'fallback-secret-for-local-dev-only',
  'ci-test-secret-at-least-16-chars-long',
  'CHANGE_ME_AT_LEAST_32_CHARS_RANDOM',
]);

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

function hasDatabaseConfig(): boolean {
  if (process.env.DATABASE_URL?.trim()) return true;
  return Boolean(
    process.env.DB_HOST?.trim() &&
      process.env.DB_USER?.trim() &&
      process.env.DB_PASSWORD?.trim() &&
      process.env.DB_NAME?.trim(),
  );
}

/** Parse comma-separated browser origins for CORS allow-list. */
export function getConfiguredCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Fail fast when production deployment is misconfigured.
 * Dev/test environments keep relaxed defaults.
 */
export function validateEnvironmentAtStartup(): void {
  if (isProductionRuntime()) {
    if (process.env.AUTH_STRICT !== 'true') {
      throw new Error(
        'Production startup blocked: AUTH_STRICT must be "true" when NODE_ENV=production',
      );
    }

    if (!hasDatabaseConfig()) {
      throw new Error(
        'Production startup blocked: DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME must be set',
      );
    }

    const secret = process.env.JWT_SECRET?.trim();
    if (!secret || secret.length < 32) {
      throw new Error(
        'Production startup blocked: JWT_SECRET must be at least 32 characters',
      );
    }
    if (WEAK_JWT_SECRETS.has(secret)) {
      throw new Error('Production startup blocked: JWT_SECRET is a known placeholder value');
    }

    const tenantId = process.env.TENANT_ID?.trim();
    if (!tenantId || !UUID_RE.test(tenantId)) {
      throw new Error(
        'Production startup blocked: TENANT_ID must be a valid UUID when NODE_ENV=production',
      );
    }

    if (process.env.VALIDATION_STRICT === 'false') {
      logger.warn(
        '[env] WARNING: VALIDATION_STRICT=false in production — validation gates are bypassed',
      );
    }

    if (getConfiguredCorsOrigins().length === 0) {
      throw new Error(
        'Production startup blocked: CORS_ORIGIN must list at least one allowed browser origin',
      );
    }
  }



  if (isAuthStrict() && process.env.JWT_SECRET) {
    const secret = process.env.JWT_SECRET.trim();
    if (secret.length < 16) {
      throw new Error('JWT_SECRET must be at least 16 characters when AUTH_STRICT is enabled');
    }
    if (WEAK_JWT_SECRETS.has(secret) && isProductionRuntime()) {
      throw new Error('JWT_SECRET is a known placeholder value');
    }
  }
}

export function getConfiguredTenantId(): string | undefined {
  const tenantId = process.env.TENANT_ID?.trim();
  if (tenantId && UUID_RE.test(tenantId)) return tenantId;
  return undefined;
}

export function isValidTenantUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export { isProductionRuntime };
