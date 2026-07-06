import { getAuthToken, refreshAccessToken } from './apiClient';

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Refresh access token ~1 minute before JWT expiry so live/report polls stay authorized. */
export function scheduleAccessTokenRefresh(accessToken?: string | null): void {
  clearTimeout(refreshTimer);
  const token = accessToken ?? getAuthToken();
  if (!token) return;

  try {
    const base64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!base64) return;
    const payload = JSON.parse(atob(base64)) as { exp?: number };
    if (!payload.exp) return;
    const refreshAt = payload.exp * 1000 - 60_000;
    const delay = Math.max(refreshAt - Date.now(), 5_000);
    refreshTimer = setTimeout(() => {
      void (async () => {
        const next = await refreshAccessToken();
        if (next) scheduleAccessTokenRefresh(next);
      })();
    }, delay);
  } catch {
    // ignore malformed token
  }
}

export function stopAccessTokenRefresh(): void {
  clearTimeout(refreshTimer);
  refreshTimer = undefined;
}
