import SuperTokens from 'supertokens-auth-react';
import EmailPassword from 'supertokens-auth-react/recipe/emailpassword';
import Session from 'supertokens-auth-react/recipe/session';

declare global {
  interface Window {
    __SUPERTOKENS_INIT__?: boolean;
  }
}

export function initSuperTokens() {
  if (window.__SUPERTOKENS_INIT__) {
    console.warn('[SuperTokens] Already initialized, skipping.');
    return;
  }

  const host = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  // Web: Vite proxies `/auth/*` → backend (no prefix strip needed).
  // APK (VITE_API_URL set): talks directly to the backend host at `/auth`.
  // Both use apiBasePath '/auth' so the server-side ST config always matches.
  const apiDomain = host || window.location.origin;
  const apiBasePath = '/auth';

  console.info(`[SuperTokens] Initializing. API: ${apiDomain}${apiBasePath}, Origin: ${window.location.origin}`);

  SuperTokens.init({
    appInfo: {
      appName: 'Zedral M1',
      apiDomain,
      websiteDomain: window.location.origin,
      apiBasePath,
      websiteBasePath: '/login',
    },
    recipeList: [
      EmailPassword.init(),
      Session.init({ tokenTransferMethod: 'header' }),
    ],
  });

  window.__SUPERTOKENS_INIT__ = true;
}
