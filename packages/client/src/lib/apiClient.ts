/**
 * Central API client for the M1 PWA.
 *
 * - Prefixes all calls with the configured API host plus `/api` (Vite proxy
 *   still handles the empty-host web case).
 * - Sends cookies (`credentials: 'include'`) and attaches SuperTokens Bearer
 *   headers in header-transfer mode (ST does not intercept `/api/*`).
 * - Per-request timeout + bounded GET retry for weak-network zones.
 * - Unwraps the `{ data, meta, errors }` envelope when present, otherwise
 *   returns the raw JSON body (the current backend returns bare objects).
 * - Surfaces a typed ApiError so callers can branch on status / offline.
 */

import { useAuthStore } from './authStore';
import { getActiveCrmMill } from './crmMillContext';
import { getNetworkQuality, startNetworkQualityProbe } from './networkQuality';

let serverOffset = 0;

function updateServerOffset(serverDateStr: string | null) {
  if (!serverDateStr) return;
  const serverTime = new Date(serverDateStr).getTime();
  if (isNaN(serverTime)) return;

  // Offset = Server - Local. If Server is ahead, offset is positive.
  const nextOffset = serverTime - Date.now();

  // Minor smoothing: don't jump for small jitters < 200ms
  if (Math.abs(nextOffset - serverOffset) > 200 || serverOffset === 0) {
    serverOffset = nextOffset;
  }
}

/** Returns the current time adjusted for clock skew between client and server. */
export function getServerTime(): number {
  return Date.now() + serverOffset;
}

/** Fallback before RTT samples; live default is max(3s, p95×3) capped at 30s. */
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 400;

function resolveTimeoutMs(override?: number): number {
  if (override != null) return override;
  startNetworkQualityProbe();
  const p95 = getNetworkQuality().p95RttMs;
  if (p95 == null || p95 <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(30_000, Math.max(3_000, Math.round(p95 * 3)));
}

/** Web: `/api` via nginx. APK/native: `VITE_API_URL` host + `/api` (see M1-10). */
function resolveApiBase(): string {
  const host = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  if (!host) return '/api';
  return host.endsWith('/api') ? host : `${host}/api`;
}

const API_BASE = resolveApiBase();
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

console.info(`[apiClient] API Base: ${API_BASE}, Version: ${APP_VERSION}`);

export class ApiError extends Error {
  status: number;
  body: unknown;
  isOffline: boolean;
  preventRetry?: boolean;

  constructor(message: string, status: number, body: unknown, isOffline = false, preventRetry = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.isOffline = isOffline;
    this.preventRetry = preventRetry;
  }
}

export function getAuthToken(): string | null {
  return sessionStorage.getItem('mock_jwt');
}

/** Headers for fetch calls that bypass apiClient (SuperTokens header mode — ST skips /api/*). */
export async function getAuthHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  try {
    const Session = (await import('supertokens-auth-react/recipe/session')).default;
    if (await Session.doesSessionExist()) {
      const accessToken = await Session.getAccessToken();
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
        headers['st-auth-mode'] = 'header';
      }
    }
  } catch {
    // leave without session headers — caller will get 401 like apiClient
  }
  return headers;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  /** Skip throwing on non-2xx; return the parsed body instead. */
  raw?: boolean;
  timeoutMs?: number;
}

interface ApiEnvelope<T> {
  data: T;
  errors: unknown;
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  /** Outbox sync: return 401 without clearing the session / hard-redirecting. */
  skipAuthLogout?: boolean;
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

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

function mergeAbortSignals(a?: AbortSignal | null, b?: AbortSignal | null): AbortSignal | undefined {
  if (!a && !b) return undefined;
  if (!a) return b ?? undefined;
  if (!b) return a;
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (a.aborted || b.aborted) {
    ctrl.abort();
    return ctrl.signal;
  }
  a.addEventListener('abort', abort);
  b.addEventListener('abort', abort);
  return ctrl.signal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGetError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.preventRetry || err.status === 401) return false;
  if (err.isOffline || err.status === 0) return true;
  if (err.status >= 500) return true;
  return false;
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

export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const generationAtStart = authGeneration;
  const tokenAtStart = getAuthToken();
  const { timeoutMs: timeoutOverride, signal: callerSignal, skipAuthLogout = false, ...fetchOpts } = options;
  const timeoutMs = resolveTimeoutMs(timeoutOverride);
  const headers = new Headers(fetchOpts.headers);

  if (!headers.has('Content-Type') && fetchOpts.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-App-Version', APP_VERSION);

  let finalPath = path;
  if (typeof window !== 'undefined' && path.startsWith('/6hi/') && !path.includes('machine=')) {
    const pathname = window.location.pathname.toLowerCase();
    let machine: string | null = null;
    if (pathname.includes('/4hi')) machine = '4HI';
    else if (pathname.includes('/2hi')) machine = '2HI';
    else if (pathname.includes('/6hi')) machine = '6HI';
    if (!machine) machine = getActiveCrmMill();
    if (machine) {
      finalPath = path.includes('?') ? `${path}&machine=${machine}` : `${path}?machine=${machine}`;
    }
  }

  const attachSessionHeaders = async () => {
    if (isPublicAuthPath(path) || path.startsWith('/auth/')) return false;
    try {
      const Session = (await import('supertokens-auth-react/recipe/session')).default;
      if (!(await Session.doesSessionExist())) return false;
      const accessToken = await Session.getAccessToken();
      if (!accessToken) return false;
      headers.set('Authorization', `Bearer ${accessToken}`);
      headers.set('st-auth-mode', 'header');
      return true;
    } catch {
      return false;
    }
  };

  const doFetch = async (): Promise<Response> => {
    await attachSessionHeaders();
    const { signal: timeoutSignal, cancel } = withTimeout(timeoutMs);
    const signal = mergeAbortSignals(callerSignal, timeoutSignal);
    const url = `${API_BASE}${finalPath}`;
    try {
      return await fetch(url, {
        ...fetchOpts,
        headers,
        credentials: 'include',
        signal,
      });
    } catch (networkErr) {
      const isAbort = networkErr instanceof Error && networkErr.name === 'AbortError';
      let msg = 'Network unavailable or request blocked by CORS';
      if (networkErr instanceof Error) {
        if (isAbort) msg = 'Request timed out';
        else if (networkErr.message) msg = `Network error: ${networkErr.message}`;
      }
      throw new ApiError(msg, 0, networkErr, true, true);
    } finally {
      cancel();
    }
  };

  let res: Response = await doFetch();
  // Prefer custom X-Server-Date as 'Date' is often hidden by browsers/WebViews.
  updateServerOffset(res.headers.get('X-Server-Date') ?? res.headers.get('Date'));

  if (res.status === 401 && !isPublicAuthPath(path)) {
    console.warn(`[apiClient] 401 Unauthorized for ${path}. Auth Gen: ${generationAtStart}, Headers:`,
      Object.fromEntries(res.headers.entries()));
  }

  // SuperTokens header transfer can race refresh — try once before nuking the session.
  if (res.status === 401 && !isPublicAuthPath(path) && !path.startsWith('/auth/')) {
    try {
      const Session = (await import('supertokens-auth-react/recipe/session')).default;
      if (await Session.doesSessionExist()) {
        const refreshed = await Session.attemptRefreshingSession();
        if (refreshed && authGeneration === generationAtStart) {
          res = await doFetch(); // re-reads access token after refresh
        }
      }
    } catch {
      // Fall through to logout handling below.
    }
  }

  if (res.status === 401 && !skipAuthLogout && !isPublicAuthPath(path) && !path.startsWith('/auth/')) {
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

async function requestOnce<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, raw = false, timeoutMs } = options;

  const res = await apiFetch(path, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    timeoutMs,
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

async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const isGet = method === 'GET';
  const maxAttempts = isGet ? MAX_RETRIES + 1 : 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await requestOnce<T>(path, options);
    } catch (err) {
      lastErr = err;
      if (!isGet || attempt >= maxAttempts - 1) throw err;
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw err;
      if (!isRetryableGetError(err)) throw err;
      const backoff = RETRY_BASE_MS * 2 ** attempt + Math.random() * 100;
      await sleep(backoff);
    }
  }
  throw lastErr;
}

export const apiClient = {
  get: <T = unknown>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
  request,
};
