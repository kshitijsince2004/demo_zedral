import { useEffect, useState } from 'react';
import { Network } from '@capacitor/network';
import {
  EMPTY_DEVICE_STATUS,
  isAndroidApk,
  readDeviceStatus,
  type DeviceStatusSnapshot,
} from '../operator/native/deviceStatus';

const POLL_MS = 15_000;

export function useAndroidDeviceStatus(): DeviceStatusSnapshot {
  const [status, setStatus] = useState<DeviceStatusSnapshot>(EMPTY_DEVICE_STATUS);

  useEffect(() => {
    if (!isAndroidApk()) return;

    let cancelled = false;

    const poll = async () => {
      const next = await readDeviceStatus();
      if (!cancelled) setStatus(next);
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
