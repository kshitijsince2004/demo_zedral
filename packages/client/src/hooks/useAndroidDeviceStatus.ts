import { useEffect } from 'react';
import { Network } from '@capacitor/network';
import { isAndroidApk } from '../operator/native/deviceStatus';
import { useDeviceStatusStore } from '../operator/native/deviceStatusStore';

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
    if ((window as any).__DEVICE_STATUS_POLLING__) return;
    (window as any).__DEVICE_STATUS_POLLING__ = true;

    const poll = async () => {
      await useDeviceStatusStore.getState().update();
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    const networkListener = Network.addListener('networkStatusChange', () => void poll());

    return () => {
      // In practice, this hook stays mounted with the shell,
      // but we clean up for safety.
      // (window as any).__DEVICE_STATUS_POLLING__ = false;
      // clearInterval(id);
      // void networkListener.then((handle) => handle.remove());
    };
  }, []);

  return status;
}
