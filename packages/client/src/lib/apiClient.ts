/**
 * Central API client for the M1 PWA.
 *
 * - Prefixes all calls with `/api` (Vite proxy strips it and forwards to the
 *   backend at http://localhost:3005).
 * - Attaches the bearer token from session storage on every request.
 * - Refreshes expired access tokens automatically using the refresh token.
 * - Unwraps the `{ data, meta, errors }` envelope when present, otherwise
 *   returns the raw JSON body (the current backend returns bare objects).
 * - Surfaces a typed ApiError so callers can branch on status / offline.
 */

import { useAuthStore } from './authStore';

const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  body: unknown;
  isOffline: boolean;

  constructor(message: string, status: number, body: unknown, isOffline = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.isOffline = isOffline;
  }
}

export function getAuthToken(): string | null {
  return sessionStorage.getItem('mock_jwt');
}

function getRefreshToken(): string | null {
  return sessionStorage.getItem('mock_refresh');
}

function setAuthTokens(accessToken: string, refreshToken?: string) {
  sessionStorage.setItem('mock_jwt', accessToken);
  if (refreshToken) sessionStorage.setItem('mock_refresh', refreshToken);
}

/** Bearer headers for fetch calls that bypass apiClient (e.g. sync batch). */
export function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  /** Skip throwing on non-2xx; return the parsed body instead. */
  raw?: boolean;
  /** Internal: skip one refresh retry to avoid infinite loops. */
  _retried?: boolean;
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.accessToken) {
          setAuthTokens(data.accessToken, data.refreshToken ?? refreshToken);
          return data.accessToken as string;
        }
        return null;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, raw = false, _retried = false } = options;
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const isPublicAuthPath =
    path.startsWith('/auth/badge-pin') ||
    path.startsWith('/auth/token') ||
    path.startsWith('/auth/refresh');
  if (token && !isPublicAuthPath) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError('Network unavailable', 0, networkErr, true);
  }

  if (res.status === 401 && !_retried && !path.startsWith('/auth/')) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request<T>(path, { ...options, _retried: true });
    }
    sessionStorage.removeItem('mock_jwt');
    sessionStorage.removeItem('mock_refresh');
    useAuthStore.getState().logout();
  }

  let parsed: any = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok && !raw) {
    const message =
      (parsed && (parsed.error || parsed.message)) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, parsed);
  }

  if (parsed && typeof parsed === 'object' && 'data' in parsed && 'errors' in parsed) {
    return parsed.data as T;
  }
  return parsed as T;
}

export const apiClient = {
  get: <T = any>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T = any>(path: string) => request<T>(path, { method: 'DELETE' }),
  request,
};
