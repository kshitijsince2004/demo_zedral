/**
 * Central API client for the M1 PWA.
 *
 * - Prefixes all calls with the configured API host plus `/api` (Vite proxy
 *   still handles the empty-host web case).
 * - Sends cookies (`credentials: 'include'`); SuperTokens' fetch interceptor
 *   attaches/refreshes the session cookie.
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

/** Headers for fetch calls that bypass apiClient (cookies via credentials:'include'). */
export function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  /** Skip throwing on non-2xx; return the parsed body instead. */
  raw?: boolean;
}

interface ApiEnvelope<T> {
  data: T;
  errors: unknown;
}

function isRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return isRecord(value) && 'data' in (value as object) && 'errors' in (value as object);
}

function formatApiError(parsed: unknown, status: number): string {
  if (!isRecord(parsed)) return `Request failed (${status})`;
  const record = parsed as Record<string, unknown>;
  const direct = record.error ?? record.message;
  if (typeof direct === 'string') return direct;
  if (isRecord(direct)) {
    const d = direct as Record<string, unknown>;
    const formErrors = Array.isArray(d.formErrors) ? d.formErrors.filter((e): e is string => typeof e === 'string') : [];
    const fieldErrors = isRecord(d.fieldErrors)
      ? Object.entries(d.fieldErrors as Record<string, unknown>).flatMap(([field, messages]) =>
          Array.isArray(messages) ? messages.map((m) => `${field}: ${String(m)}`) : [],
        )
      : [];
    const parts = [...formErrors, ...fieldErrors];
    if (parts.length > 0) return parts.join('; ');
  }
  return `Request failed (${status})`;
}

/** Bumped on login/logout so stale 401 responses cannot clear a fresh session. */
let authGeneration = 0;

export function markAuthGeneration(): void {
  authGeneration += 1;
}

export function getAuthGeneration(): number {
  return authGeneration;
}

function isPublicAuthPath(path: string): boolean {
  return (
    path.startsWith('/auth/badge-pin') ||
    path.startsWith('/auth/token') ||
    path.startsWith('/auth/refresh')
  );
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const generationAtStart = authGeneration;
  const tokenAtStart = getAuthToken();
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-App-Version', APP_VERSION);

  // Inject machine code into /6hi/ API requests
  let finalPath = path;
  if (typeof window !== 'undefined' && path.startsWith('/6hi/')) {
    const pathname = window.location.pathname.toLowerCase();
    let machine: string | null = null;
    if (pathname.includes('/4hi')) machine = '4HI';
    else if (pathname.includes('/2hi')) machine = '2HI';
    else if (pathname.includes('/6hi')) machine = '6HI';

    if (machine && !path.includes('machine=')) {
      finalPath = path.includes('?') ? `${path}&machine=${machine}` : `${path}?machine=${machine}`;
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${finalPath}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (networkErr) {
    throw new ApiError('Network unavailable', 0, networkErr, true);
  }

  // ST fetch interceptor refreshes the session; a remaining 401 means the session is dead.
  if (res.status === 401 && !isPublicAuthPath(path) && !path.startsWith('/auth/')) {
    const sameSession =
      authGeneration === generationAtStart && getAuthToken() === tokenAtStart;
    if (sameSession) {
      sessionStorage.removeItem('mock_jwt');
      sessionStorage.removeItem('mock_refresh');
      useAuthStore.getState().logout();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login?session=expired');
      }
    }
  }

  return res;
}

async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, raw = false } = options;

  const res = await apiFetch(path, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
    const message = formatApiError(parsed, res.status);
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
