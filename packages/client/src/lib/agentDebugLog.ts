/** Temporary debug instrumentation — remove after connectivity issue resolved. */
export function agentDebugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  // #region agent log
  fetch('http://127.0.0.1:7577/ingest/58d95c05-b61c-4a37-a3ee-d40d653006c8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'beb2a9' },
    body: JSON.stringify({
      sessionId: 'beb2a9',
      location,
      message,
      data,
      hypothesisId,
      timestamp: Date.now(),
      runId: 'pre-fix',
    }),
  }).catch(() => {});
  // #endregion
}

export function isHrsDebugPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.includes('hrs') || p.includes('/stations/hrs');
}
