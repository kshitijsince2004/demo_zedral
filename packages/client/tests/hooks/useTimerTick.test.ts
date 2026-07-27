import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeTimerTick } from '../../src/hooks/useTimerTick';

describe('subscribeTimerTick', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies all subscribers on a single interval', () => {
    vi.useFakeTimers();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeTimerTick(a);
    const unsubB = subscribeTimerTick(b);

    vi.advanceTimersByTime(3000);
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(3);

    unsubA();
    vi.advanceTimersByTime(2000);
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(5);

    unsubB();
    vi.advanceTimersByTime(5000);
    expect(b).toHaveBeenCalledTimes(5);
  });
});
