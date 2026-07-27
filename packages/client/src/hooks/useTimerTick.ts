type TickListener = () => void;

const listeners = new Set<TickListener>();
let intervalId: ReturnType<typeof setInterval> | null = null;

/** Single shared 1 Hz tick for all live timers — avoids duplicate intervals. */
export function subscribeTimerTick(listener: TickListener): () => void {
  listeners.add(listener);
  if (!intervalId) {
    intervalId = setInterval(() => {
      for (const fn of listeners) fn();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}
