/** Opt-in: pause display polls / probes while the tab is hidden. */
export function idleThrottleEnabled(): boolean {
  return import.meta.env.VITE_IDLE_THROTTLE === 'true';
}

export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * setInterval that, when VITE_IDLE_THROTTLE=true, pauses while hidden and
 * fires one tick immediately on becoming visible.
 */
export function whenVisibleInterval(ms: number, tick: () => void): () => void {
  if (!idleThrottleEnabled() || typeof document === 'undefined') {
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }

  let id: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (id != null) return;
    id = setInterval(tick, ms);
  };
  const stop = () => {
    if (id == null) return;
    clearInterval(id);
    id = null;
  };

  const onVis = () => {
    if (document.visibilityState === 'hidden') {
      stop();
    } else {
      tick();
      start();
    }
  };

  if (document.visibilityState !== 'hidden') start();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVis);
  };
}
