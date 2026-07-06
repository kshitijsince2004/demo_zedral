/**
 * Central API client for the M1 PWA.
 *
 * - Prefixes all calls with the configured API host plus `/api` (Vite proxy
 *   still handles the empty-host web case).
 * - Attaches the bearer token from session storage on every request.
 * - Refreshes expired access tokens automatically using the refresh token.
 * - Unwraps the `{ data, meta, errors }` envelope when present, otherwise
 *   returns the raw JSON body (the current backend returns bare objects).
 * - Surfaces a typed ApiError so callers can branch on status / offline.
 */

import { useAuthStore } from './authStore';

/** Web: `/api` via nginx. APK/native: `VITE_API_URL` host + `/api` (see M1-10). */
function resolveApiBase(): string {
  const host = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  if (!host) return '/api';
  return host.endsWith('/api') ? host : `${host}/api`;
}

const API_BASE = resolveApiBase();
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

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
  useAuthStore.setState({ token: accessToken });
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

interface RefreshResponse {
  accessToken?: string;
  refreshToken?: string;
}

interface ApiEnvelope<T> {
  data: T;
  errors: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return isRecord(value) && 'data' in value && 'errors' in value;
}

let refreshInFlight: Promise<string | null> | null = null;

function isPublicAuthPath(path: string): boolean {
  return (
    path.startsWith('/auth/badge-pin') ||
    path.startsWith('/auth/token') ||
    path.startsWith('/auth/refresh')
  );
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-App-Version': APP_VERSION },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as RefreshResponse;
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

export async function apiFetch(path: string, options: RequestInit & { _retried?: boolean } = {}): Promise<Response> {
  const { _retried = false, ...fetchOptions } = options;
  const token = getAuthToken();
  const headers = new Headers(fetchOptions.headers);

  if (!headers.has('Content-Type') && fetchOptions.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-App-Version', APP_VERSION);

  if (token && !isPublicAuthPath(path)) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers,
    });
  } catch (networkErr) {
    throw new ApiError('Network unavailable', 0, networkErr, true);
  }

  if (res.status === 401 && !_retried && !path.startsWith('/auth/')) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch(path, { ...options, _retried: true });
    }
    sessionStorage.removeItem('mock_jwt');
    sessionStorage.removeItem('mock_refresh');
    useAuthStore.getState().logout();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.assign('/login?session=expired');
    }
  }

  return res;
}

async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, raw = false, _retried = false } = options;

  let res: Response;
  res = await apiFetch(path, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    _retried,
  });

  let parsed: unknown = null;
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
      isRecord(parsed) && typeof (parsed.error ?? parsed.message) === 'string'
        ? String(parsed.error ?? parsed.message)
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, parsed);
  }

  if (isApiEnvelope<T>(parsed)) {
    return parsed.data as T;
  }
  return parsed as T;
}

export const apiClient = {
  get: <T = unknown>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
  request,
};
