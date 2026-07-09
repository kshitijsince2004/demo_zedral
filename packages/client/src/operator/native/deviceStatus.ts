import { Capacitor, registerPlugin } from '@capacitor/core';

export interface DeviceStatusSnapshot {
  batteryLevel: number;
  isCharging: boolean;
  wifiConnected: boolean;
  connectionType: 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown';
  wifiRssi: number;
  wifiBars: number;
}

interface DeviceStatusPlugin {
  getStatus(): Promise<DeviceStatusSnapshot>;
}

const DeviceStatusNative = registerPlugin<DeviceStatusPlugin>('DeviceStatus');

export const isAndroidApk = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function readDeviceStatus(): Promise<DeviceStatusSnapshot | null> {
  if (!isAndroidApk()) return null;
  try {
    return await DeviceStatusNative.getStatus();
  } catch {
    return null;
  }
}
