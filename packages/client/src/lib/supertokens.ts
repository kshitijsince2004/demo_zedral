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
      Session.init({
        tokenTransferMethod: 'header',
        override: {
          functions: (original) => ({
            ...original,
            // ponytail: ST strips a manually set Authorization on /api — only intercept /auth
            // (refresh/signout). apiClient attaches Bearer + st-auth-mode for /api itself.
            shouldDoInterceptionBasedOnUrl: (url, apiDom, sessionTokenBackendDomain) => {
              try {
                const path = new URL(url, typeof window !== 'undefined' ? window.location.origin : apiDom).pathname;
                if (path.startsWith('/auth') || path.startsWith(apiBasePath)) {
                  return original.shouldDoInterceptionBasedOnUrl(url, apiDom, sessionTokenBackendDomain);
                }
              } catch {
                /* fall through */
              }
              return false;
            },
          }),
        },
      }),
    ],
  });

  window.__SUPERTOKENS_INIT__ = true;
}
