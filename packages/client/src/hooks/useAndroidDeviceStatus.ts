import { useEffect } from 'react';
import { Network } from '@capacitor/network';
import { isAndroidApk } from '../operator/native/deviceStatus';
import { useDeviceStatusStore } from '../operator/native/deviceStatusStore';

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
      await useDeviceStatusStore.getState().update();
    };

    void poll();
    const intervalId = setInterval(() => void poll(), POLL_MS);
    const listenerPromise = Network.addListener('networkStatusChange', () => void poll());

    return () => {
      window.__DEVICE_STATUS_POLLING__ = false;
      clearInterval(intervalId);
      void listenerPromise.then((handle) => handle.remove());
    };
  }, []);

  return status;
}
