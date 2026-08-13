import { Network } from '@capacitor/network';
import { getNetworkQuality, startNetworkQualityProbe } from './networkQuality';
import { idleThrottleEnabled, isDocumentHidden } from './idleThrottle';
import { notifyProductionChanged } from './productionSync';

type ConnectionType = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';

function webConnectionType(): ConnectionType | null {
  if (typeof navigator === 'undefined') return null;
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  const t = conn?.effectiveType;
  if (t === 'slow-2g' || t === '2g' || t === '3g' || t === '4g') return t;
  return t ? 'unknown' : null;
}

/** True when focus is in an editable field (typing must not fight polls). */
export function isInputFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/** Pause aggressive polling on offline / 2G links. */
export async function shouldPauseLivePolling(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;

  try {
    const status = await Network.getStatus();
    if (!status.connected) return true;
  } catch {
    // Web fallback below.
  }

  const webType = webConnectionType();
  return webType === 'slow-2g' || webType === '2g';
}

type RefreshOpts = {
  /** Skip refresh while typing; still refresh ~every 60s and on blur via callers. */
  pauseWhileTyping?: boolean;
};

/** Module-scoped so re-created refreshInterval closures share one timer (Fix 4b). */
let typingSince: number | null = null;
let typingListenersWired = false;
let visibilityResumeWired = false;

function wireTypingResume(): void {
  if (typingListenersWired || typeof document === 'undefined') return;
  typingListenersWired = true;
  document.addEventListener('focusout', () => {
    if (typingSince == null) return;
    // Defer so activeElement has updated after blur.
    queueMicrotask(() => {
      if (isInputFocused()) return;
      typingSince = null;
      notifyProductionChanged();
    });
  });
}

function wireVisibilityResume(): void {
  if (visibilityResumeWired || typeof document === 'undefined' || !idleThrottleEnabled()) return;
  visibilityResumeWired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') notifyProductionChanged();
  });
}

/**
 * SWR refreshInterval callback — adaptive refresh based on network/typing/visibility.
 * Note: SWR expects a synchronous number; returning `0` disables the polling loop.
 * degraded; activeMs on good.
 */
export function networkAwareRefreshInterval(activeMs: number, opts?: RefreshOpts) {
  startNetworkQualityProbe();
  if (opts?.pauseWhileTyping) wireTypingResume();
  wireVisibilityResume();

  return (): number => {
    let nextIntervalMs: number | null = null;

    const hidden = idleThrottleEnabled() && isDocumentHidden();
    if (hidden) {
      // Keep SWR's timer alive (visibility listener resumes earlier if needed).
      nextIntervalMs = 86_400_000;
    } else if (opts?.pauseWhileTyping && isInputFocused()) {
      const now = Date.now();
      if (typingSince == null) typingSince = now;
      // Cap max pause ~60s. Return positive ms so SWR keeps scheduling (0 kills the loop).
      if (now - typingSince < 60_000) {
        nextIntervalMs = 60_000;
      }
    } else {
      typingSince = null;
    }

    if (nextIntervalMs == null) {
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      const { level, online } = getNetworkQuality();
      if (offline || !online || level === 'bad') {
        // Keep polling loop alive; if we truly can't reach the server we'll just fail fetches.
        // This prevents SWR from stopping background refreshes permanently.
        nextIntervalMs = Math.min(120_000, Math.max(30_000, activeMs * 2));
      } else if (level === 'degraded') {
        nextIntervalMs = Math.min(60_000, Math.max(30_000, activeMs * 2));
      } else {
        nextIntervalMs = activeMs;
      }
    }

    return nextIntervalMs;
  };
}
