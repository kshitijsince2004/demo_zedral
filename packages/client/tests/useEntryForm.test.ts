/**
 * Tests for the useEntryForm hook's core save logic.
 *
 * The `executeSave` function is the pure, injectable core of the hook and is
 * tested here without React or a DOM environment.  The tests cover:
 *
 *   - Req 2.1 / 2.3: valid entries are enqueued through the sync engine
 *   - Req 2.4: invalid entries are blocked with field-level errors; queue unchanged
 *   - Req 2.5: save status is derived from the engine's actual outcome
 *   - Req 2.2: queued status when offline (pending count > 0)
 *   - Req 2.3: transmitted status when online (pending count === 0)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the syncEngine module before importing the hook so that IndexedDB
// (unavailable in the node test environment) is never instantiated.
vi.mock('../src/lib/syncEngine', () => ({
  syncEngine: {
    enqueue: vi.fn(),
    getPendingCount: vi.fn(),
    subscribe: vi.fn(),
    sync: vi.fn(),
  },
}));

import { executeSave } from '../src/hooks/useEntryForm';
import type { SaveDependencies } from '../src/hooks/useEntryForm';
import type { ValidationResult } from '@m1/shared-validation';
import type { SyncQueueItem } from '../src/lib/offlineStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQueueItem(id = 'item-1'): SyncQueueItem {
  return {
    id,
    endpoint: '/entries/hrs',
    method: 'POST',
    payload: {},
    timestamp: new Date().toISOString(),
    status: 'QUEUED',
    retryCount: 0,
  };
}

function validResult(): ValidationResult {
  return { isValid: true, errors: [], warnings: [] };
}

function invalidResult(field = 'coilNo', message = 'Required'): ValidationResult {
  return {
    isValid: false,
    errors: [{ field, message, severity: 'BLOCK' }],
    warnings: [],
  };
}

function makeDeps(overrides: Partial<SaveDependencies> = {}): SaveDependencies {
  return {
    validate: vi.fn().mockReturnValue(validResult()),
    enqueue: vi.fn().mockResolvedValue(makeQueueItem()),
    getPendingCount: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
}

// ─── Minimal valid HRS payload ────────────────────────────────────────────────

const validHrsPayload = {
  id: 'entry-1',
  shiftLogId: 'shift-1',
  coilNo: 'COIL-001',
  startTime: new Date(),
  nominalWidthMm: 1250,
  actualWidthMm: 1248,
  nominalThkMm: 3.0,
  weightMt: 12.5,
  scrapMt: 0.1,
  slitSlots: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('executeSave — validation gate (Req 2.4)', () => {
  it('blocks the save and returns field-level errors when validation fails', async () => {
    const deps = makeDeps({
      validate: vi.fn().mockReturnValue(invalidResult('coilNo', 'Coil Number is required')),
    });

    const { outcome, status } = await executeSave('HRS', validHrsPayload, deps);

    expect(outcome.outcome).toBe('blocked');
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].field).toBe('coilNo');
    expect(outcome.errors[0].message).toBe('Coil Number is required');
    expect(status).toBe('idle');
  });

  it('does NOT call enqueue when validation fails (queue unchanged)', async () => {
    const deps = makeDeps({
      validate: vi.fn().mockReturnValue(invalidResult()),
    });

    await executeSave('HRS', validHrsPayload, deps);

    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('returns all field-level errors when multiple fields are invalid', async () => {
    const multiError: ValidationResult = {
      isValid: false,
      errors: [
        { field: 'coilNo', message: 'Required', severity: 'BLOCK' },
        { field: 'weightMt', message: 'Must be positive', severity: 'BLOCK' },
      ],
      warnings: [],
    };
    const deps = makeDeps({ validate: vi.fn().mockReturnValue(multiError) });

    const { outcome } = await executeSave('HRS', validHrsPayload, deps);

    expect(outcome.outcome).toBe('blocked');
    expect(outcome.errors).toHaveLength(2);
  });
});

describe('executeSave — enqueue on valid save (Req 2.1, 2.3)', () => {
  it('calls enqueue with the correct endpoint and payload when validation passes', async () => {
    const deps = makeDeps();

    await executeSave('HRS', validHrsPayload, deps);

    expect(deps.enqueue).toHaveBeenCalledOnce();
    expect(deps.enqueue).toHaveBeenCalledWith('/entries/hrs', 'POST', {
      ...validHrsPayload,
      processCode: 'HRS',
    });
  });

  it('uses the lower-cased process code in the endpoint path', async () => {
    const deps = makeDeps();

    await executeSave('CRM', validHrsPayload, deps);

    expect(deps.enqueue).toHaveBeenCalledWith('/entries/crm', 'POST', {
      ...validHrsPayload,
      processCode: 'CRM',
    });
  });

  it('echos the ruleset version to the server on submit', async () => {
    const deps = makeDeps();
    const effectiveRuleset = { rules: {}, version: 42 };

    await executeSave('HRS', validHrsPayload, deps, effectiveRuleset);

    expect(deps.enqueue).toHaveBeenCalledWith('/entries/hrs', 'POST', {
      ...validHrsPayload,
      processCode: 'HRS',
      rulesetVersion: 42,
    });
  });

  it('returns the queueId from the enqueued item', async () => {
    const item = makeQueueItem('my-queue-id');
    const deps = makeDeps({ enqueue: vi.fn().mockResolvedValue(item) });

    const { outcome } = await executeSave('HRS', validHrsPayload, deps);

    expect(outcome.queueId).toBe('my-queue-id');
  });

  it('returns no errors when the save succeeds', async () => {
    const deps = makeDeps();

    const { outcome } = await executeSave('HRS', validHrsPayload, deps);

    expect(outcome.errors).toHaveLength(0);
  });
});

describe('executeSave — save status derivation (Req 2.2, 2.3, 2.5)', () => {
  it('returns "queued" status when pending count > 0 (offline / not yet synced)', async () => {
    const deps = makeDeps({ getPendingCount: vi.fn().mockResolvedValue(3) });

    const { outcome, status } = await executeSave('HRS', validHrsPayload, deps);

    expect(outcome.outcome).toBe('queued');
    expect(status).toBe('queued');
  });

  it('returns "transmitted" status when pending count === 0 (synced immediately)', async () => {
    const deps = makeDeps({ getPendingCount: vi.fn().mockResolvedValue(0) });

    const { outcome, status } = await executeSave('HRS', validHrsPayload, deps);

    expect(outcome.outcome).toBe('transmitted');
    expect(status).toBe('transmitted');
  });

  it('status is never a hardcoded message — it is derived from the engine', async () => {
    // Simulate the engine reporting 1 pending item (offline scenario)
    const deps = makeDeps({ getPendingCount: vi.fn().mockResolvedValue(1) });
    const { status: offlineStatus } = await executeSave('HRS', validHrsPayload, deps);
    expect(offlineStatus).toBe('queued');

    // Simulate the engine reporting 0 pending items (online scenario)
    const deps2 = makeDeps({ getPendingCount: vi.fn().mockResolvedValue(0) });
    const { status: onlineStatus } = await executeSave('HRS', validHrsPayload, deps2);
    expect(onlineStatus).toBe('transmitted');
  });
});

describe('executeSave — enqueue failure handling', () => {
  it('returns "blocked" outcome with a _form error when enqueue throws', async () => {
    const deps = makeDeps({
      enqueue: vi.fn().mockRejectedValue(new Error('IndexedDB unavailable')),
    });

    const { outcome, status } = await executeSave('HRS', validHrsPayload, deps);

    expect(outcome.outcome).toBe('blocked');
    expect(outcome.errors[0].field).toBe('_form');
    expect(outcome.errors[0].message).toBe('IndexedDB unavailable');
    expect(status).toBe('failed');
  });
});

describe('executeSave — process code routing', () => {
  it('routes each canonical process code to the correct endpoint', async () => {
    const codes = ['HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'];

    for (const code of codes) {
      const deps = makeDeps();
      await executeSave(code, validHrsPayload, deps);
      expect(deps.enqueue).toHaveBeenCalledWith(
        `/entries/${code.toLowerCase()}`,
        'POST',
        { ...validHrsPayload, processCode: code },
      );
    }
  });
});

describe('executeSave — validation is called with the correct process code', () => {
  it('passes the process code to the validator', async () => {
    const deps = makeDeps();

    await executeSave('CRM', validHrsPayload, deps);

    expect(deps.validate).toHaveBeenCalledWith('CRM', validHrsPayload, undefined);
  });

  it('passes the full payload to the validator unchanged', async () => {
    const deps = makeDeps();
    const payload = { ...validHrsPayload, extraField: 'test' };

    await executeSave('HRS', payload, deps);

    expect(deps.validate).toHaveBeenCalledWith('HRS', payload, undefined);
  });
});
