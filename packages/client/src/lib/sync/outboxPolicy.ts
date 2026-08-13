/**
 * Client-error responses that mean "nothing to do" / "cannot apply" -
 * safe to drop from the outbox without supervisor PIN.
 */
export function isBenignSyncClientError(status: number, body: string): boolean {
  if (status === 409) return true;
  if (status < 400 || status >= 500) return false;
  const text = body || '';
  return (
    /ACTIVE_SESSION_CONFLICT/i.test(text) ||
    /Forbidden:\s*No access to machine/i.test(text) ||
    /Forbidden:\s*No write access to line/i.test(text) ||
    /Only active \(DRAFT or REOPENED\) shifts can be marked completed/i.test(text) ||
    /already (completed|submitted|closed)/i.test(text) ||
    /IDEMPOTENCY_IN_FLIGHT/i.test(text)
  );
}

/** Extract mill code from handover outbox URLs, e.g. /machines/handover/6HI/session */
export function machineCodeFromOutboxUrl(url: string): string | null {
  const m = url.match(/\/machines\/handover\/([^/?#]+)/i);
  return m?.[1] ? m[1].toUpperCase() : null;
}