/** Tier-3 shared-write conflict (PERF-E2/E3). Outbox treats HTTP 409 as benign. */

export type VersionConflictError = Error & {
  code: 'VERSION_CONFLICT';
  current: unknown;
};

export function throwVersionConflict(current: unknown, detail = 'VERSION_CONFLICT'): never {
  throw Object.assign(new Error(detail), {
    code: 'VERSION_CONFLICT' as const,
    current,
  });
}

export function isVersionConflict(err: unknown): err is VersionConflictError {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'VERSION_CONFLICT';
}

export function versionConflictBody(err: VersionConflictError) {
  return { code: 'VERSION_CONFLICT' as const, current: err.current, error: err.message };
}
