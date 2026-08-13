import { useEffect } from 'react';
import { Network } from '@capacitor/network';
import { isAndroidApk } from '../operator/native/deviceStatus';
import { useDeviceStatusStore } from '../operator/native/deviceStatusStore';
import { whenVisibleInterval } from '../lib/idleThrottle';
import { isInputFocused } from '../lib/networkAwareInterval';

declare global {
  interface Window {
    __DEVICE_STATUS_POLLING__?: boolean;
  }
}

const POLL_MS = 15_000;

/**
 * Hook to manage device status polling.
 * Syncs results into a global store to prevent flickering on remount.
 */
export function useAndroidDeviceStatus() {
  const status = useDeviceStatusStore();

  useEffect(() => {
    if (!isAndroidApk()) return;

    // Only one poller should run
    if (window.__DEVICE_STATUS_POLLING__) return;
    window.__DEVICE_STATUS_POLLING__ = true;

    const poll = async () => {
      if (isInputFocused()) return;
      await useDeviceStatusStore.getState().update();
    };

    void poll();
    const stopPoll = whenVisibleInterval(POLL_MS, () => void poll());
    const listenerPromise = Network.addListener('networkStatusChange', () => void poll());

    return () => {
      window.__DEVICE_STATUS_POLLING__ = false;
      stopPoll();
      void listenerPromise.then((handle) => handle.remove());
    };
  }, []);

  return status;
}
