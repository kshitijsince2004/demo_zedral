import type { Role } from './authStore';
import { isUserScopePath, userScopePath } from './userScope';

export type MillCode = '6HI' | '4HI' | '2HI';

export function millCodeFromPath(pathname: string, activeMachine?: MillCode | null): MillCode {
  if (pathname.startsWith('/2hi')) return '2HI';
  if (pathname.startsWith('/4hi')) return '4HI';
  if (pathname.startsWith('/6hi')) return '6HI';
  if (isUserScopePath(pathname) && activeMachine) return activeMachine;
  return '6HI';
}

export function millBasePath(code: MillCode, workspace?: { username: string; role: Role } | null): string {
  if (workspace) return userScopePath(workspace.username, workspace.role);
  if (code === '4HI') return '/4hi';
  if (code === '2HI') return '/2hi';
  return '/6hi';
}

export function isMillPath(pathname: string): boolean {
  return (
    pathname.startsWith('/6hi') ||
    pathname.startsWith('/4hi') ||
    pathname.startsWith('/2hi') ||
    isUserScopePath(pathname)
  );
}

export function millPathForCode(
  code: string,
  workspace?: { username: string; role: Role } | null,
): string {
  if (code === '4HI') return workspace ? userScopePath(workspace.username, workspace.role) : '/4hi';
  if (code === '2HI') return workspace ? userScopePath(workspace.username, workspace.role) : '/2hi';
  if (code === '6HI') return workspace ? userScopePath(workspace.username, workspace.role) : '/6hi';
  return `/coming-soon/${code}`;
}
