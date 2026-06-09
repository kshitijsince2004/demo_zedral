/**
 * Central auth configuration. AUTH_STRICT defaults to true in production.
 * Set AUTH_STRICT=false for local dev without JWT_SECRET / legacy PIN fallback.
 */
export function isAuthStrict(): boolean {
  if (process.env.AUTH_STRICT === 'false') return false;
  if (process.env.AUTH_STRICT === 'true') return true;
  return process.env.NODE_ENV === 'production';
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (!isAuthStrict()) {
    return process.env.JWT_SECRET || 'fallback-secret-for-local-dev-only';
  }
  throw new Error(
    'JWT_SECRET must be set to a value of at least 16 characters when AUTH_STRICT is enabled'
  );
}

/** Call once at server startup — fails fast in strict mode without JWT_SECRET. */
export function validateAuthConfigAtStartup(): void {
  getJwtSecret();
}
