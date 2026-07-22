import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../src/lib/apiClient';

describe('apiClient timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('throws ApiError with preventRetry on abort/timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
      ),
    );

    const promise = apiFetch('/health', { timeoutMs: 50 });
    const expectRejection = expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      isOffline: true,
      preventRetry: true,
    } satisfies Partial<ApiError>);

    await vi.advanceTimersByTimeAsync(60);
    await expectRejection;
  });
});