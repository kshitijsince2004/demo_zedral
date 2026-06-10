import React, { useEffect, useState } from 'react';
import { type Tone, toneText, toneBg, toneBorder } from '../../lib/tones';

/** Shows a banner when the browser reports the device is offline. */
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

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) {
    return null;
  }

  const tone: Tone = 'warning';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className={`flex items-center gap-3 rounded-md border px-4 py-3 text-sm font-medium animate-slide-in ${toneText[tone]} ${toneBg[tone]} ${toneBorder[tone]}`}
    >
      <span className="shrink-0" aria-hidden="true">
        <OfflineIcon />
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider">Offline</span>
        <span aria-hidden="true" className="opacity-40">
          •
        </span>
        <span>Check your network connection</span>
      </span>
    </div>
  );
}
