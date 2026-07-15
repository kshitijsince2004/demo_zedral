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
  // Vite proxies `/api/*` → backend (strips `/api`). Direct host (APK) talks to `/auth`.
  const apiDomain = host || window.location.origin;
  const apiBasePath = host ? '/auth' : '/api/auth';

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
