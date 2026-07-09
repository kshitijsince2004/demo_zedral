import { Capacitor, registerPlugin } from '@capacitor/core';
import { Network } from '@capacitor/network';

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

export const EMPTY_DEVICE_STATUS: DeviceStatusSnapshot = {
  batteryLevel: -1,
  isCharging: false,
  wifiConnected: false,
  connectionType: 'unknown',
  wifiRssi: -127,
  wifiBars: 0,
};

export const isAndroidApk = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

function mapNetworkType(
  connectionType: string,
): DeviceStatusSnapshot['connectionType'] {
  if (connectionType === 'wifi') return 'wifi';
  if (connectionType === 'cellular') return 'cellular';
  if (connectionType === 'none') return 'none';
  return 'unknown';
}

async function networkFallback(): Promise<DeviceStatusSnapshot> {
  const net = await Network.getStatus();
  const wifiConnected = net.connected && net.connectionType === 'wifi';
  return {
    ...EMPTY_DEVICE_STATUS,
    wifiConnected,
    connectionType: mapNetworkType(net.connectionType),
    wifiBars: wifiConnected ? 2 : 0,
  };
}

export async function readDeviceStatus(): Promise<DeviceStatusSnapshot> {
  if (!isAndroidApk()) return EMPTY_DEVICE_STATUS;

  try {
    const native = await DeviceStatusNative.getStatus();
    if (native.batteryLevel >= 0 || native.wifiConnected) {
      return native;
    }
  } catch {
    // Fall through to Capacitor Network when the custom plugin is unavailable.
  }

  try {
    return await networkFallback();
  } catch {
    return EMPTY_DEVICE_STATUS;
  }
}
