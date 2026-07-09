import { useEffect, useState } from 'react';
import { Network } from '@capacitor/network';
import { isAndroidApk, readDeviceStatus, type DeviceStatusSnapshot } from '../operator/native/deviceStatus';

const POLL_MS = 30_000;

export function useAndroidDeviceStatus(): DeviceStatusSnapshot | null {
  const [status, setStatus] = useState<DeviceStatusSnapshot | null>(null);

  useEffect(() => {
    if (!isAndroidApk()) return;

    let cancelled = false;

    const poll = async () => {
      const next = await readDeviceStatus();
      if (!cancelled && next) setStatus(next);
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    const networkListener = Network.addListener('networkStatusChange', () => void poll());

    return () => {
      cancelled = true;
      clearInterval(id);
      void networkListener.then((handle) => handle.remove());
    };
  }, []);

  return status;
}
