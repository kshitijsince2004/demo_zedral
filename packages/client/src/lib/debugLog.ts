/** Per-tick / routine logs — silent in prod unless VITE_VERBOSE_LOGS=true. */
export function debugLog(...args: unknown[]): void {
  if (import.meta.env.DEV || import.meta.env.VITE_VERBOSE_LOGS === 'true') {
    console.info(...args);
  }
}
