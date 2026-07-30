/**
 * Central auth configuration. AUTH_STRICT defaults to true in production.
 * Set AUTH_STRICT=false for local dev without JWT_SECRET / legacy PIN fallback.
 */
import { validateEnvironmentAtStartup } from './envValidation';

export function isAuthStrict(): boolean {
  if (process.env.AUTH_STRICT === 'false') return false;
  if (process.env.AUTH_STRICT === 'true') return true;
  return process.env.NODE_ENV === 'production';
}

/** Call once at server startup — fails fast on misconfiguration. */
export function validateAuthConfigAtStartup(): void {
  validateEnvironmentAtStartup();
  getSuperTokensConfig(); // Will throw in strict mode if missing
}

export function getSuperTokensConfig() {
  const connectionURI = process.env.SUPERTOKENS_CORE_URI || 'http://localhost:3567';
  const apiKey = process.env.SUPERTOKENS_API_KEY || 'local-development-key';
  const apiDomain = process.env.API_DOMAIN || 'http://localhost:3005';
  const websiteDomain = process.env.WEBSITE_DOMAIN || 'http://localhost:5173';

  if (isAuthStrict()) {
    if (!process.env.SUPERTOKENS_CORE_URI) throw new Error('SUPERTOKENS_CORE_URI must be set in strict mode');
    if (!process.env.API_DOMAIN) throw new Error('API_DOMAIN must be set in strict mode');
    if (!process.env.WEBSITE_DOMAIN) throw new Error('WEBSITE_DOMAIN must be set in strict mode');
  }

  return { connectionURI, apiKey, apiDomain, websiteDomain };
}
