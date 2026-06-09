import React, { useEffect, useState } from 'react';
import { syncEngine } from '../../lib/syncEngine';
import { type Tone, toneText, toneBg, toneBorder } from '../../lib/tones';

/**
 * Persistent offline/queued banner (Requirements 2.6, 10.3).
 *
 * Shows the number of entries still pending sync — items in QUEUED or FAILED
 * state, derived from `syncEngine.getPendingCount()`. The banner is visible
 * whenever that count is greater than zero and conveys status with color PLUS
 * an icon PLUS a text label (never color alone — Requirement 10.5).
 *
 * Mounted once in the app shell so it remains visible across every screen
 * (Property 4: the displayed count equals the pending-item count at all times).
 */

interface BannerStatus {
  tone: Tone;
  label: string;
  Icon: React.FC;
}

/** Cloud-with-slash icon — used when the device is offline. */
const OfflineIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m2 2 20 20" />
    <path d="M5.8 5.8A6 6 0 0 0 8 17h9a4 4 0 0 0 1.9-7.5" />
    <path d="M9.5 5.3A5.5 5.5 0 0 1 17.6 9" />
  </svg>
);

/** Rotating arrows icon — used while queued items are syncing/pending online. */
const SyncIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 0 0-9-9 9 9 0 0 0-6.7 3L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9 9 0 0 0 6.7-3L21 16" />
    <path d="M21 21v-5h-5" />
  </svg>
);

function getStatus(isOnline: boolean): BannerStatus {
  if (!isOnline) {
    return { tone: 'warning', label: 'Offline', Icon: OfflineIcon };
  }
  return { tone: 'info', label: 'Pending sync', Icon: SyncIcon };
}

export function OfflineBanner() {
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    let active = true;

    const refresh = () => {
      syncEngine
        .getPendingCount()
        .then((count) => {
          if (active) setPendingCount(count);
        })
        .catch(() => {
          /* leave the last known count if the store read fails */
        });
    };

    const handleOnline = () => {
      setIsOnline(true);
      refresh();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refresh();
    };

    // Initial read + subscribe to queue changes so the count stays accurate.
    refresh();
    const unsubscribe = syncEngine.subscribe(refresh);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Visible only when there are pending items (Property 4 / Requirement 10.3).
  if (pendingCount <= 0) {
    return null;
  }

  const { tone, label, Icon } = getStatus(isOnline);
  const entryWord = pendingCount === 1 ? 'entry' : 'entries';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className={`flex items-center gap-3 rounded-md border px-4 py-3 text-sm font-medium animate-slide-in ${toneText[tone]} ${toneBg[tone]} ${toneBorder[tone]}`}
    >
      <span className="shrink-0" aria-hidden="true">
        <Icon />
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        <span aria-hidden="true" className="opacity-40">
          •
        </span>
        <span>
          <span className="font-mono tabular-nums font-semibold">{pendingCount}</span>{' '}
          {entryWord} queued for sync
        </span>
      </span>
    </div>
  );
}
