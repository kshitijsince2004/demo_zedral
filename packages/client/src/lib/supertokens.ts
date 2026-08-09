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
            // Skip interception for app `/api/*` (apiClient sets Bearer; ST would strip it).
            // Still intercept `/auth/*` and `/api/auth/*`. Always pass an absolute URL into
            // original() — relative paths make its domain normaliser throw, and our old
            // catch returned false so badge-pin never saved header tokens.
            shouldDoInterceptionBasedOnUrl: (url, apiDom, sessionTokenBackendDomain) => {
              try {
                const absolute = new URL(
                  String(url),
                  typeof window !== 'undefined' ? window.location.origin : apiDom,
                );
                const path = absolute.pathname;
                // /health is the APK status-bar ping — ST must not wrap it.
                if (path === '/health') {
                  return false;
                }
                if (path.startsWith('/api') && !path.startsWith('/api/auth')) {
                  return false;
                }
                return original.shouldDoInterceptionBasedOnUrl(
                  absolute.href,
                  apiDom,
                  sessionTokenBackendDomain,
                );
              } catch {
                return false;
              }
            },
          }),
        },
      }),
    ],
  });

  window.__SUPERTOKENS_INIT__ = true;
}
