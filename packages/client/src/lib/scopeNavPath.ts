import { isUserScopePath } from './userScope';

/**
 * Join workspace base + child segments into an absolute path.
 * Always starts with `/` so react-router navigate() never doubles the user-scope segment.
 * Empty/missing base returns `/` (callers must guard before navigating to capture etc.).
 */
export function scopeNavPath(basePath: string, ...segments: string[]): string {
  const raw = (basePath || '').trim();
  if (!raw || raw === '/') {
    return '/';
  }
  const cleanBase = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/+$/, '') || '/';
  const parts = segments
    .flatMap((s) => String(s).split('/'))
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  if (parts.length === 0) return cleanBase;
  return `${cleanBase}/${parts.join('/')}`;
}

/**
 * Repair relative-navigate mistakes: `/alice.operator/alice.operator/capture`
 * → `/alice.operator/capture`. Returns null when pathname is already fine.
 */
export function normalizeDoubledUserScopePath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] !== parts[1]) return null;
  if (!isUserScopePath(`/${parts[0]}`)) return null;
  const rest = parts.slice(2);
  return rest.length > 0 ? `/${parts[0]}/${rest.join('/')}` : `/${parts[0]}`;
}
