import { create } from 'zustand';
import { EMPTY_DEVICE_STATUS, readDeviceStatus, type DeviceStatusSnapshot } from './deviceStatus';

interface DeviceStatusState extends DeviceStatusSnapshot {
  set: (status: Partial<DeviceStatusSnapshot>) => void;
  update: () => Promise<void>;
}

/**
 * Global store for device status (battery, wifi, ping).
 * Prevents UI flickering/resetting to "Offline" during component remounts.
 */
export const useDeviceStatusStore = create<DeviceStatusState>((set) => ({
  ...EMPTY_DEVICE_STATUS,
  set: (status) => set(status),
  update: async () => {
    const next = await readDeviceStatus();
    set(next);
  },
}));
