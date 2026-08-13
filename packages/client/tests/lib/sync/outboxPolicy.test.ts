import { describe, expect, it } from 'vitest';
import { isBenignSyncClientError, machineCodeFromOutboxUrl } from '../../../src/lib/sync/outboxPolicy';

describe('outboxPolicy', () => {
  it('classifies known benign sync errors', () => {
    expect(isBenignSyncClientError(409, 'anything')).toBe(true);
    expect(
      isBenignSyncClientError(
        400,
        'ACTIVE_SESSION_CONFLICT: Another operator holds an active session on this machine.',
      ),
    ).toBe(true);
    expect(isBenignSyncClientError(403, 'Forbidden: No access to machine 4HI')).toBe(true);
    expect(isBenignSyncClientError(403, '{"error":"Forbidden: No write access to line RWD"}')).toBe(true);
    expect(
      isBenignSyncClientError(400, '{"error":"Invalid production payload","details":[{"path":"actualWidthMm"}]}'),
    ).toBe(true);
    expect(
      isBenignSyncClientError(400, 'Only active (DRAFT or REOPENED) shifts can be marked completed.'),
    ).toBe(true);
    expect(isBenignSyncClientError(400, 'Machine status is required')).toBe(false);
    expect(isBenignSyncClientError(400, '{"error":"IDEMPOTENCY_IN_FLIGHT"}')).toBe(true);
    expect(isBenignSyncClientError(409, '{"error":"IDEMPOTENCY_IN_FLIGHT"}')).toBe(true);
  });

  it('extracts machine code from handover URLs', () => {
    expect(machineCodeFromOutboxUrl('/machines/handover/6HI/session')).toBe('6HI');
    expect(machineCodeFromOutboxUrl('/shift-logs/55/complete')).toBeNull();
  });
});
